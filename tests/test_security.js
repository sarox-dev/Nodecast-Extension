const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const local = {}, sync = {apiUrl:'http://localhost:5000/api/capture', apiToken:'legacy', defaultProject:'Work'};
const store = object => ({
  async get(keys, callback) {
    const result = keys == null ? {...object} : Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(keys)).filter(k => k in object).map(k => [k, object[k]]));
    if (callback) callback(result);
    return result;
  },
  async set(values) { Object.assign(object, values); },
  async remove(keys) { keys.forEach(k => delete object[k]); },
});
let listener, requests = [], created = [];
const event = {addListener() {}};
const scope = {
  console, URL, AbortController, setTimeout, clearTimeout, crypto:require('node:crypto').webcrypto,
  fetch:async (url, options={}) => {
    requests.push({url, options});
    if(url.endsWith('/exchange')) return {ok:true,json:async()=>({token:'new-token',username:'member',user_id:'u'})};
    return {ok:true,json:async()=>({username:'member',settings:{}})};
  },
  chrome:{
    storage:{local:store(local),sync:store(sync)},
    runtime:{onInstalled:event,onStartup:event,onMessage:{addListener(fn){listener=fn}},getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'test'})},
    contextMenus:{onClicked:event},
    commands:{onCommand:event},
    tabs:{create:async info=>created.push(info),sendMessage:async()=>{}},
  },
};
vm.createContext(scope);
vm.runInContext(fs.readFileSync('background.js','utf8'),scope);
const message = (request,sender) => new Promise(resolve => listener(request,sender,resolve));
(async()=>{
  await vm.runInContext('storageReady',scope);
  assert.equal(local.apiToken,'legacy');
  assert.equal(sync.apiToken,undefined);
  assert.equal(sync.apiUrl,undefined);
  assert.equal(local.defaultProject,'Work');
  assert.equal(vm.runInContext("isAllowedCoreOrigin('http://nodecast.lan:5000')",scope),true);
  assert.equal(vm.runInContext("isAllowedCoreOrigin('http://192.168.8.116:5000')",scope),true);
  assert.equal(vm.runInContext("isAllowedCoreOrigin('http://user:pass@nodecast.lan:5000')",scope),false);
  const rejected=await message({action:'pairWithCore',coreOrigin:'http://nodecast.lan:5000',code:'pairing-code'},
    {tab:{id:1},url:'http://attacker.example/'});
  assert.equal(rejected.success,false);
  const pairing=message({action:'pairWithCore',coreOrigin:'http://nodecast.lan:5000',code:'pairing-code'},
    {tab:{id:1},url:'http://nodecast.lan:5000/'});
  assert.equal(local.apiToken,'legacy');
  assert.equal(requests.length,0);
  const id=created[0].url.split('#')[1];
  const review=await message({action:'reviewPairing',id},{url:created[0].url});
  assert.equal(review.origin,'http://nodecast.lan:5000');
  const approved=await message({action:'approvePairing',id},{url:created[0].url});
  assert.equal(approved.success,true);
  assert.equal((await pairing).success,true);
  assert.equal(local.apiUrl,'http://nodecast.lan:5000/api/capture');
  assert.equal(local.apiToken,'new-token');
  const denied=await message({action:'disconnectCore'},{tab:{id:2},url:'http://192.168.9.1/'});
  assert.equal(denied.success,false);
  assert.equal(local.apiToken,'new-token');
  await message({action:'fetchLayout',url:'https://example.com/article?secret=token#private'},{tab:{id:1},url:'https://example.com/'});
  await new Promise(resolve=>setImmediate(resolve));
  assert(!requests.at(-1).url.includes('secret'));
  console.log('Extension migration, LAN pairing confirmation, sender and URL privacy checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
