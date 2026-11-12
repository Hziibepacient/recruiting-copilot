"""Local recruiting ledger only: never connects to or sends to a platform."""
import argparse
import datetime as dt
import json
import os
import time
from contextlib import contextmanager
from pathlib import Path

TZ = dt.timezone(dt.timedelta(hours=8))
STATES = {'prepared', 'pending', 'verified', 'uncertain', 'not_sent', 'failed'}
BLOCKING = {'pending', 'uncertain'}


@contextmanager
def file_lock(path, timeout=10):
    """Serialize local read/check/append transactions across processes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        if stream.seek(0, os.SEEK_END) == 0:
            stream.write(b'0'); stream.flush()
        deadline = time.monotonic() + timeout
        while True:
            try:
                stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Local ledger is busy; retry after the active operation finishes')
                time.sleep(.02)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def read_events(root):
    events = []
    for path in sorted(root.glob('????-??-??.jsonl')):
        for line_no, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f'{path.name}:{line_no}: invalid JSON; reconcile before sending') from exc
            if not isinstance(event, dict) or not event.get('key') or event.get('status') not in STATES:
                raise ValueError(f'{path.name}:{line_no}: invalid ledger event')
            event = dict(event, _date=path.stem)
            events.append(event)
    # Project accounting dates in memory; never rewrite historical files.
    # Receipt time/file date stays the actual observation time. All outcomes
    # of one permit belong to its first pending day in Shanghai.
    permit_days = {}
    legacy_days = {}
    for event in events:
        explicit = event.get('attempt_day')
        if explicit is not None:
            try:
                if dt.date.fromisoformat(explicit).isoformat() != explicit:
                    raise ValueError('noncanonical date')
            except (ValueError, TypeError) as exc:
                raise ValueError('invalid attempt_day; reconcile before sending') from exc
        key, permit = event['key'], event.get('permit_id')
        if permit:
            identity = (key, permit)
            if event['status'] == 'pending':
                permit_days.setdefault(identity, event['_date'])
            attempt_day = permit_days.get(identity, explicit or event['_date'])
        else:
            # Older records without permits can still follow their one open
            # attempt; a terminal outcome closes that chain for a later retry.
            if event['status'] == 'pending':
                legacy_days.setdefault(key, event['_date'])
            attempt_day = legacy_days.get(key, explicit or event['_date'])
            if event['status'] in {'verified', 'not_sent', 'failed'}:
                legacy_days.pop(key, None)
        event['_attempt_date'] = attempt_day
    return events


def summary(root, date):
    with file_lock(root / '.ledger.lock'):
        return _summary_unlocked(root, date)


def _summary_unlocked(root, date):
    events = read_events(root)
    latest = {}
    latest_today = {}
    for event in events:
        latest[event['key']] = event
        if event['_attempt_date'] == date:
            latest_today[event['key']] = event
    counts = {state: sum(e['status'] == state for e in latest_today.values()) for state in sorted(STATES)}
    unresolved = [dict(key=k, status=e['status'], date=e['_attempt_date'], observed_date=e['_date']) for k, e in latest.items()
                  if e['status'] in BLOCKING]
    return {'date': date, 'timezone': 'Asia/Shanghai', 'counts': counts,
            'conservative_used_today': counts['verified'] + counts['pending'] + counts['uncertain'],
            'unresolved_all_dates': unresolved,
            'known_verified_all_dates': sum(e['status'] == 'verified' for e in latest.values()),
            'platform_remaining': None,
            'accounting_basis': 'First pending Shanghai day; receipt observation time is preserved separately.',
            'note': 'Local known records only; reconcile UI and legacy identity aliases before sending.'}


def identity_key(record):
    fields = ('platform', 'account_id', 'candidate_id', 'job_id')
    for field in fields:
        if not isinstance(record.get(field), str) or not record[field].strip() or '|' in record[field]:
            raise ValueError(f'{field} must be an observed nonempty string without |')
    return '|'.join(record[field] for field in fields)


def append_record(root, record, config, now=None):
    with file_lock(root / '.ledger.lock'):
        return _append_record_unlocked(root, record, config, now)


def _append_record_unlocked(root, record, config, now=None):
    if not isinstance(record, dict):
        raise ValueError('record-file must contain exactly one object, not a batch')
    if record.get('status') not in STATES:
        raise ValueError('unsupported status')
    now = (now or dt.datetime.now(TZ)).astimezone(TZ)
    key = identity_key(record)
    events = read_events(root)
    history = [e for e in events if e['key'] == key]
    if any(e['status'] == 'verified' for e in history):
        raise ValueError('already verified; do not resend or downgrade history')
    state = record['status']
    previous = history[-1]['status'] if history else None
    if state in {'verified', 'uncertain', 'not_sent', 'failed'} and previous in BLOCKING:
        previous_permit = history[-1].get('permit_id')
        if previous_permit and record.get('permit_id') != previous_permit:
            raise ValueError('outcome does not belong to the pending permit')
    if state in {'prepared', 'pending'} and previous in BLOCKING:
        raise ValueError('unresolved send; inspect receipt before another attempt')
    if state == 'pending':
        if record.get('authorization_confirmed') is not True:
            raise ValueError('current user authorization required')
        if not record.get('source_url') or not (record.get('screenshot') or record.get('detail_evidence')) or not record.get('greeting'):
            raise ValueError('source_url, screenshot or detail_evidence, and greeting required')
        for name in config['required_gate_keys']:
            gate = record.get('gates', {}).get(name, {})
            if gate.get('state') != 'pass' or not str(gate.get('evidence', '')).strip():
                raise ValueError(f'gate {name} must pass with evidence; no automatic inference')
        report = _summary_unlocked(root, now.date().isoformat())
        if report['unresolved_all_dates']:
            raise ValueError('unresolved ledger attempts exist; reconcile first')
        if report['conservative_used_today'] >= config['daily_limit']:
            raise ValueError('local daily limit reached')
        if config['greeting']['mode'] == 'platform_default':
            if record['greeting'] != config['greeting']['expected_default_text']:
                raise ValueError('default greeting mismatch')
    if state in {'verified', 'uncertain'} and previous not in BLOCKING:
        raise ValueError('pending attempt required before outcome')
    if state == 'verified' and not str(record.get('receipt', '')).strip():
        raise ValueError('explicit same-candidate receipt required')
    if state in {'not_sent', 'failed'} and previous in BLOCKING and not record.get('pre_send_failure_evidence'):
        raise ValueError('prove final send was not clicked; otherwise record uncertain')
    saved = {k: v for k, v in record.items() if not k.startswith('_')}
    saved['attempt_day'] = (history[-1]['_attempt_date']
                            if state in {'verified', 'uncertain', 'not_sent', 'failed'} and previous in BLOCKING
                            else now.date().isoformat())
    saved.update(key=key, time=now.astimezone(TZ).isoformat())
    root.mkdir(parents=True, exist_ok=True)
    path = root / (now.date().isoformat() + '.jsonl')
    with path.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(saved, ensure_ascii=False) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    return {'saved': str(path), 'key': key, 'status': state}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    report = sub.add_parser('summary')
    report.add_argument('--dir', required=True, type=Path)
    report.add_argument('--date', default=dt.datetime.now(TZ).date().isoformat())
    record = sub.add_parser('record')
    record.add_argument('--dir', required=True, type=Path)
    record.add_argument('--record-file', required=True, type=Path)
    record.add_argument('--config', type=Path, default=Path(__file__).resolve().parent / '.runtime' / 'ledger-config.json')
    args = parser.parse_args()
    try:
        if args.command == 'summary':
            dt.date.fromisoformat(args.date)
            result = summary(args.dir, args.date)
        else:
            result = append_record(args.dir, json.loads(args.record_file.read_text(encoding='utf-8-sig')),
                                   json.loads(args.config.read_text(encoding='utf-8-sig')))
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError) as exc:
        parser.exit(2, f'Ledger stopped: {exc}\n')


if __name__ == '__main__':
    main()
