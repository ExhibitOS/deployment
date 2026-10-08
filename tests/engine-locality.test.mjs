// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindLocalEngine,localEndpoint} from '../src/engine-locality.mjs';
import {diagnoseApplication} from '../src/application-readiness.mjs';
import {safeError} from '../src/diagnostics.mjs';

test('only Unix and named-pipe transports qualify, including refusal of localhost TCP',()=>{
 assert.equal(localEndpoint('unix:///tmp/docker.sock'),'unix:///tmp/docker.sock');
 assert.equal(localEndpoint('npipe:////./pipe/docker_engine'),'npipe:////./pipe/docker_engine');
 for(const v of ['tcp://127.0.0.1:2375','tcp://localhost:2376','ssh://synthetic@remote','https://remote','unix://relative','unix:///','unix:///socket?secret','unix:///socket\n','npipe:////./pipe/../remote'])assert.throws(()=>localEndpoint(v),/ENGINE_LOCALITY_UNVERIFIED/);
});
test('context override wins over host; every observation uses pinned host and frozen env',async()=>{
 const env={DOCKER_CONTEXT:'selected',DOCKER_HOST:'tcp://remote:2375',PATH:'/synthetic',SYNTHETIC_VALUE:'original'},calls=[];
 const run=async(args,opts)=>{calls.push([args,opts]);if(args[0]==='context')return JSON.stringify('unix:///selected.sock');return 'observation';};
 const binding=await bindLocalEngine(run,()=>env);env.SYNTHETIC_VALUE='changed';
 assert.equal(await binding.run(['ps'],{timeout:123}),'observation');await binding.verify();
 const pinned=calls.find(([args])=>args[0]==='--host');assert.deepEqual(pinned[0],['--host','unix:///selected.sock','ps']);assert.equal(pinned[1].timeout,123);assert.equal(pinned[1].env.SYNTHETIC_VALUE,'original');assert.equal(pinned[1].env.DOCKER_CONTEXT,undefined);assert.equal(pinned[1].env.DOCKER_HOST,undefined);assert(Object.isFrozen(pinned[1].env));
 assert(calls.filter(([args])=>args[0]==='context').every(([args])=>args.at(-1)==='selected'));
});
test('host override skips context discovery and remote failure happens before census or HTTP',async()=>{
 let calls=0,http=0;
 await assert.rejects(diagnoseApplication({project:'synthetic',services:['platform']},{service:'platform',getEnvironment:()=>({DOCKER_HOST:'tcp://127.0.0.1:2375'}),run:async()=>{calls++;return '';},readHTTP:async()=>{http++;return {};}}),/ENGINE_LOCALITY_UNVERIFIED/);
 assert.equal(calls,0);assert.equal(http,0);
 const b=await bindLocalEngine(async args=>{assert.equal(args[0],'--host');return '';},()=>({DOCKER_HOST:'unix:///tmp/docker.sock'}));await b.verify();await b.run(['ps']);
});
test('current-context switching never redirects pinned calls and refuses final authority',async()=>{
 let current='first',endpoint='unix:///first.sock';const calls=[];
 const run=async args=>{calls.push(args);return args[0]==='--host'?'':args[1]==='show'?current:JSON.stringify(endpoint);};
 const b=await bindLocalEngine(run,()=>({}));current='second';endpoint='unix:///second.sock';await b.run(['inspect','synthetic']);
 assert.deepEqual(calls.at(-1),['--host','unix:///first.sock','inspect','synthetic']);await assert.rejects(b.verify(),/ENGINE_SELECTION_CHANGED/);
});
test('endpoint/environment drift and malformed context metadata are closed safe errors',async()=>{
 let endpoint='unix:///first.sock',env={DOCKER_CONTEXT:'selected'};
 const run=async()=>JSON.stringify(endpoint);const b=await bindLocalEngine(run,()=>env);endpoint='unix:///second.sock';await assert.rejects(b.verify(),/ENGINE_SELECTION_CHANGED/);
 endpoint='unix:///first.sock';const c=await bindLocalEngine(run,()=>env);env={DOCKER_CONTEXT:'other',DOCKER_HOST:'tcp://synthetic-secret'};await assert.rejects(c.verify(),/ENGINE_SELECTION_CHANGED/);
 for(const raw of ['{}','"unix:///first.sock" "extra"','"tcp://synthetic-secret"',JSON.stringify('x'.repeat(2049))]){
  try{await bindLocalEngine(async()=>raw,()=>({DOCKER_CONTEXT:'selected'}));assert.fail();}catch(e){assert.equal(safeError(e).code,'ENGINE_LOCALITY_UNVERIFIED');assert(!JSON.stringify(safeError(e)).includes('synthetic-secret'));}
 }
});
test('integrated HTTP observation refuses changed context endpoint after otherwise valid ready response',async()=>{
 const id='a'.repeat(64),project='synthetic',imageConfigDigest='sha256:'+'b'.repeat(64);
 const record={id,project,service:'platform',imageConfigDigest,running:true,state:'running',health:'healthy',exitCode:0,restarts:0};
 const ports={id,project,service:'platform',imageConfigDigest,running:true,state:'running',restarts:0,bindings:[{HostIp:'127.0.0.1',HostPort:'13200'}]};
 let endpoint='unix:///first.sock',http=0;
 const run=async(args)=>{
  if(args[0]==='context')return JSON.stringify(endpoint);
  assert.equal(args[0],'--host');assert.equal(args[1],'unix:///first.sock');const request=args.slice(2);
  return request[0]==='ps'?id:JSON.stringify(request[2].includes('bindings')?ports:record);
 };
 await assert.rejects(diagnoseApplication({project,services:['platform']},{service:'platform',run,getEnvironment:()=>({DOCKER_CONTEXT:'selected'}),readHTTP:async()=>{http++;endpoint='unix:///second.sock';return {status:200,contentType:'application/json; charset=utf-8',cacheControl:'no-store',body:JSON.stringify({schemaVersion:'1.0.0-draft.1',protocolVersion:'1',platformVersion:'0.1.0',ready:true,services:['platform','api','database','web','storage'].map(name=>({name,status:'ready'}))})};}}),/ENGINE_SELECTION_CHANGED/);
 assert.equal(http,1);
});
test('integrated remote context and current-context drift refuse before any HTTP',async()=>{
 const id='a'.repeat(64),project='synthetic',imageConfigDigest='sha256:'+'b'.repeat(64);
 const record={id,project,service:'platform',imageConfigDigest,running:true,state:'running',health:'healthy',exitCode:0,restarts:0};
 const ports={id,project,service:'platform',imageConfigDigest,running:true,state:'running',restarts:0,bindings:[{HostIp:'127.0.0.1',HostPort:'13200'}]};
 let http=0,engine=0;
 await assert.rejects(diagnoseApplication({project,services:['platform']},{service:'platform',getEnvironment:()=>({DOCKER_CONTEXT:'remote',DOCKER_HOST:'unix:///ignored.sock'}),run:async args=>{assert.equal(args[0],'context');return JSON.stringify('ssh://synthetic@remote');},readHTTP:async()=>{http++;}}),/ENGINE_LOCALITY_UNVERIFIED/);
 let shown=0;
 await assert.rejects(diagnoseApplication({project,services:['platform']},{service:'platform',getEnvironment:()=>({}),run:async args=>{
  if(args[0]==='context')return args[1]==='show'?(++shown===1?'first':'second'):JSON.stringify('unix:///'+args.at(-1)+'.sock');
  engine++;assert.deepEqual(args.slice(0,2),['--host','unix:///first.sock']);const request=args.slice(2);return request[0]==='ps'?id:JSON.stringify(request[2].includes('bindings')?ports:record);
 },readHTTP:async()=>{http++;}}),/ENGINE_SELECTION_CHANGED/);
 assert(engine>0);assert.equal(http,0);
});
