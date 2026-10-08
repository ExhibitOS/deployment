// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {boundedJSON} from '../src/bounded-json.mjs';
import {diagnoseApplication,parsePortInspection,parseReadiness,readLoopbackReadiness} from '../src/application-readiness.mjs';
import {safeError} from '../src/diagnostics.mjs';
const id='a'.repeat(64),project='synthetic-readiness',imageConfigDigest='sha256:'+'b'.repeat(64),target={project,services:['platform']};
const record={id,project,service:'platform',imageConfigDigest,running:true,state:'running',health:'healthy',exitCode:0,restarts:0};
const ports={id,project,service:'platform',imageConfigDigest,running:true,state:'running',restarts:0,bindings:[{HostIp:'127.0.0.1',HostPort:'13200'}]};
const document=(ready=true)=>({schemaVersion:'1.0.0-draft.1',protocolVersion:'1',platformVersion:'0.1.0',ready,services:['platform','api','database','web','storage'].map(name=>({name,status:ready||!['platform','database'].includes(name)?'ready':'unavailable'}))});
const response=(ready=true)=>({status:ready?200:503,body:JSON.stringify(document(ready)),contentType:'application/json; charset=utf-8',cacheControl:'no-store'});
const options=(patch={})=>({service:'platform',clock:()=>0,observedClock:()=>100,run:async args=>args[0]==='ps'?id:JSON.stringify(args[2].includes('bindings')?ports:record),readHTTP:async()=>response(),...patch});
test('bounded JSON rejects duplicate decoded keys, trailing/deep/node/big/nonfinite/prototype inputs',()=>{
 assert.equal(boundedJSON('{"x":[1,true,null,"escaped\\n"]}').x[0],1);
 for(const text of ['{"x":1,"x":2}','{"x":1,"\\u0078":2}','{"__proto__":{}}','{}{}','{"x":1e999}','['.repeat(14)+'0'+']'.repeat(14),'['+Array(2049).fill('0').join(',')+']','"'+'x'.repeat(16384)+'"'])assert.throws(()=>boundedJSON(text));
});
test('readiness binds closed protocol, every component, exact HTTP/no-store and ready semantics',()=>{
 assert.equal(parseReadiness(response()).status,'ready');assert.equal(parseReadiness(response(false)).status,'unavailable');
 for(const mutate of [r=>r.protocolVersion='2',r=>r.platformVersion='secret',r=>r.services.pop(),r=>r.services[4]=r.services[0],r=>r.services[2].status='healthy',r=>r.ready='true',r=>r.credential='synthetic-secret',r=>r.services[0].unknown=1,r=>r.services[2].status='unavailable']){const r=document();mutate(r);assert.throws(()=>parseReadiness({...response(),body:JSON.stringify(r)}),/APPLICATION_RESPONSE_INVALID/);}
 for(const patch of [{status:301},{status:503},{cacheControl:'public'},{contentType:'text/html'},{body:'{"ready":true,"ready":false}'},{body:'x'.repeat(16385)}])assert.throws(()=>parseReadiness({...response(),...patch}),/APPLICATION_RESPONSE_INVALID/);
});
test('only one exact observed loopback TCP binding binds current service and restarts',()=>{
 const expected={...record,project};assert.equal(parsePortInspection(JSON.stringify(ports),expected).port,13200);
 for(const bindings of [null,[],[{HostIp:'0.0.0.0',HostPort:'13200'}],[{HostIp:'::1',HostPort:'13200'}],[{HostIp:'127.0.0.1',HostPort:'013200'}],[{HostIp:'127.0.0.1',HostPort:'65536'}],ports.bindings.concat(ports.bindings)])assert.equal(parsePortInspection(JSON.stringify({...ports,bindings}),expected),null);
 for(const patch of [{id:'c'.repeat(64)},{project:'foreign'},{service:'database'},{imageConfigDigest:'sha256:'+'d'.repeat(64)},{restarts:1},{running:false},{extra:'synthetic-secret'}])assert.throws(()=>parsePortInspection(JSON.stringify({...ports,...patch}),expected));
});
test('application observation is explicit; engine health never substitutes for HTTP readiness',async()=>{
 const ready=await diagnoseApplication(target,options());assert.equal(ready.applicationReadiness,'ready');assert.equal(ready.applicationObservation.containerId,id);assert.equal(ready.applicationObservation.atomicSnapshot,false);assert.equal(ready.applicationObservation.realtimeAndTLS,'not-verified');
 const unavailable=await diagnoseApplication(target,options({readHTTP:async()=>response(false)}));assert.equal(unavailable.containerHealth,'healthy');assert.equal(unavailable.applicationReadiness,'unavailable');
 let requested=false;const missing=await diagnoseApplication(target,options({run:async args=>args[0]==='ps'?'':JSON.stringify(record),readHTTP:async()=>{requested=true;return response();}}));assert.equal(missing.applicationReadiness,'unknown');assert.equal(requested,false);
 await assert.rejects(diagnoseApplication(target,options({service:'foreign'})),/TARGET_INVALID/);
});
test('port change, restart, census change and late HTTP cannot return application ready',async()=>{
 let count=0;const changed=await diagnoseApplication(target,options({run:async args=>args[0]==='ps'?id:JSON.stringify(args[2].includes('bindings')?(++count===1?ports:{...ports,bindings:[{HostIp:'127.0.0.1',HostPort:'13201'}]}):record)}));assert.equal(changed.applicationReadiness,'unknown');
 count=0;await assert.rejects(diagnoseApplication(target,options({run:async args=>args[0]==='ps'?id:JSON.stringify(args[2].includes('bindings')?(++count===1?ports:{...ports,restarts:1}):record)})),/APPLICATION_BINDING_UNVERIFIED/);
 let census=0;const gone=await diagnoseApplication(target,options({run:async args=>args[0]==='ps'?(++census===3?'':id):JSON.stringify(args[2].includes('bindings')?ports:record)}));assert.equal(gone.applicationReadiness,'unknown');
 let time=0;await assert.rejects(diagnoseApplication(target,options({clock:()=>time,readHTTP:async()=>{time=20001;return response();}})),/ENGINE_TIMEOUT/);
});
test('fixed read-only engine requests and generated loopback endpoint omit secret fields',async()=>{
 const calls=[];await diagnoseApplication(target,options({run:async(args,o)=>{calls.push([args,o]);return args[0]==='ps'?id:JSON.stringify(args[2].includes('bindings')?ports:record);},readHTTP:async(b,o)=>{assert.equal(b.host,'127.0.0.1');assert.equal(b.port,13200);assert(o.timeout<=2000);return response();}}));
 assert(calls.every(([args,o])=>['ps','inspect'].includes(args[0])&&o.timeout<=8000&&!args.join(' ').match(/\.Env|\.Mounts|Health\.Log/)));
 try{await diagnoseApplication(target,options({readHTTP:async()=>{throw Error('synthetic-password');}}));assert.fail();}catch(e){assert(!JSON.stringify(safeError(e)).includes('synthetic-password'));}
});
test('actual loopback HTTP reader bounds bytes, does not follow redirects, sends no credentials',async()=>{
 let mode='ok',observed;const server=createServer((req,res)=>{observed=req.headers;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');if(mode==='redirect'){res.writeHead(302,{location:'https://example.invalid/'});return res.end('{}');}if(mode==='huge')return res.end('x'.repeat(16385));res.end(JSON.stringify(document()));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const binding={port:server.address().port};assert.equal(parseReadiness(await readLoopbackReadiness(binding,{timeout:2000})).status,'ready');assert.equal(observed.cookie,undefined);assert.equal(observed.authorization,undefined);assert.equal(observed['cache-control'],'no-cache');mode='redirect';const redirect=await readLoopbackReadiness(binding,{timeout:2000});assert.equal(redirect.status,302);assert.throws(()=>parseReadiness(redirect));mode='huge';await assert.rejects(readLoopbackReadiness(binding,{timeout:2000}),/APPLICATION_RESPONSE_INVALID/);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
