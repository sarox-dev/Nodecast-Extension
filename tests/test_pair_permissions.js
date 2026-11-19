const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function run(grant) {
  let click;
  const messages = [], requested = [];
  const elements = {
    '#approve': {disabled:true, addEventListener(_name, fn) {click=fn;}},
    '#origin': {textContent:''}, '#status': {textContent:''},
  };
  const scope = {
    URL, location:{hash:'#test-request'}, document:{querySelector:selector=>elements[selector]},
    chrome:{
      permissions:{async request(value) {requested.push(value); return grant;}},
      runtime:{sendMessage(request, callback) {
        messages.push(request);
        if (callback) callback({success:true,origin:'http://nodecast.lan:5000'});
        else return Promise.resolve({success:request.action==='approvePairing',message:'Server access was not granted'});
      }},
    },
  };
  vm.runInNewContext(fs.readFileSync('pair.js','utf8'),scope);
  await click({isTrusted:false});
  assert.equal(requested.length,0);
  await click({isTrusted:true});
  assert.equal(requested[0].origins[0],'http://nodecast.lan/*');
  assert.equal(messages.at(-1).action,grant?'approvePairing':'rejectPairing');
  assert.equal(elements['#status'].textContent,grant?'Connected. Return to Nodecast.':'Server access was not granted');
}
Promise.resolve().then(()=>run(true)).then(()=>run(false)).then(()=>console.log('Trusted pairing permission grant/denial checks passed')).catch(error=>{console.error(error);process.exitCode=1;});
