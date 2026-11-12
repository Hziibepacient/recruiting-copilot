chrome.action.onClicked.addListener(async()=>{
 const url=chrome.runtime.getURL('panel.html');
 const existing=(await chrome.tabs.query({url}))[0];
 if(existing){await chrome.tabs.update(existing.id,{active:true});return;}
 await chrome.tabs.create({url});
});
