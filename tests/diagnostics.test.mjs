// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';import assert from 'node:assert/strict';
import {diagnose,parseIds,parseInspection,validateTarget,safeError,DiagnosticError,parseResourceStats,parseWritableStorage} from '../src/diagnostics.mjs';
const id='a'.repeat(64),id2='b'.repeat(64),project='synthetic-check';
const record={id,project,service:'api',imageConfigDigest:'sha256:'+'c'.repeat(64),running:true,state:'running',health:'healthy',exitCode:0,restarts:2};
function runner(r=record,{after=id,first=id}={}){let count=0;return async args=>args[0]==='ps'?(++count===1?first:after):JSON.stringify(r);}
test('healthy exact bound observations do not attest application readiness',async()=>{
 const r=await diagnose({project,services:['api']},{run:runner(),clock:()=>100});assert.equal(r.containerHealth,'healthy');assert.equal(r.applicationReadiness,'not-verified');assert.equal(r.atomicSnapshot,false);assert.equal(r.services[0].restarts,2);
});
test('no containers, missing services, duplicate and changed census never healthy',async()=>{
 for(const [services,options] of [[['api'],{first:'',after:''}],[['api','postgres'],{}],[['api'],{after:''}]]){
  const r=await diagnose({project,services},{run:runner(record,options),clock:()=>0});assert.equal(r.containerHealth,'unknown');
 }
 const r=await diagnose({project,services:['api']},{run:async args=>args[0]==='ps'?id+'\n'+id2:JSON.stringify({...record,id:args.at(-1)}),clock:()=>0});assert.equal(r.services[0].state,'duplicate');assert.equal(r.containerHealth,'unknown');
});
test('running without health, starting, paused and unexpected scopes are unknown',async()=>{
 for(const patch of [{health:null},{health:'starting'},{state:'paused'},{state:'exited',running:false,health:'unhealthy'},{service:'undeclared'}]){const r=await diagnose({project,services:['api']},{run:runner({...record,...patch}),clock:()=>0});assert.equal(r.containerHealth,'unknown');}
 const r=await diagnose({project,services:['api']},{run:runner({...record,health:'unhealthy'}),clock:()=>0});assert.equal(r.containerHealth,'unhealthy');
});
test('strict identities, unknown fields, IDs, digest and unsafe target refuse',()=>{
 for(const patch of [{project:'other'},{id:id2},{imageConfigDigest:'platform:latest'},{running:'true'},{health:'secret'},{env:'synthetic-secret'},{service:['api']},{imageConfigDigest:['sha256:'+'c'.repeat(64)]},{exitCode:-1}])assert.throws(()=>parseInspection(JSON.stringify({...record,...patch}),id,project),/ENGINE_OUTPUT_INVALID/);
 for(const text of [id+'\n'+id,'not-an-id',Array.from({length:65},(_,i)=>i.toString(16).padStart(64,'0')).join('\n')])assert.throws(()=>parseIds(text),/ENGINE_OUTPUT_INVALID/);
 for(const t of [{project,services:[]},{project:[project],services:['api']},{project:'--help',services:['api']},{project,services:['api','api']},{project,services:['api'],extra:1}])assert.throws(()=>validateTarget(t),/TARGET_INVALID/);
});
test('engine errors and disappearing records redact raw messages and stacks',async()=>{
 const error=new Error('synthetic-password=/private/path');let caught;try{await diagnose({project,services:['api']},{run:async()=>{throw error;}});}catch(e){caught=e;}
 assert.deepEqual(safeError(caught),{version:1,state:'observation-failed',code:'ENGINE_OBSERVATION_FAILED',applicationReadiness:'not-verified'});assert(!JSON.stringify(safeError(error)).includes('synthetic-password'));assert.equal(safeError(new DiagnosticError('synthetic-password')).code,'ENGINE_OBSERVATION_FAILED');
 await assert.rejects(diagnose({project,services:['api']},{run:async args=>args[0]==='ps'?id:Promise.reject(error)}),/ENGINE_OBSERVATION_FAILED/);
});
test('fixed executable argument arrays, bounded duration, no secret fields requested',async()=>{
 const calls=[];await diagnose({project,services:['api']},{clock:()=>100,run:async(args,o)=>{calls.push([args,o]);return args[0]==='ps'?id:JSON.stringify(record);}});
 assert.equal(calls.length,3);for(const [args,o]of calls){assert(o.timeout<=8000);assert.equal(typeof args[0],'string');assert(!args.join(' ').includes('.Config.Env'));assert(!args.join(' ').includes('.State.Health.Log'));}
 let t=0;await assert.rejects(diagnose({project,services:['api']},{clock:()=>t+=20001,run:runner()}),/ENGINE_TIMEOUT/);
});

test('duplicate and escaped field names refuse before accepting last JSON value',()=>{
 const text=JSON.stringify(record);assert.throws(()=>parseInspection(text.replace('{"id":','{"id":"'+id2+'","id":'),id,project),/ENGINE_OUTPUT_INVALID/);
 assert.throws(()=>parseInspection(text.replace('"project":','"pr\\u006fject":"other","project":'),id,project),/ENGINE_OUTPUT_INVALID/);
});
test('late last census cannot return health after total monotonic deadline',async()=>{
 let time=0,count=0;
 await assert.rejects(diagnose({project,services:['api']},{clock:()=>time,run:async args=>{
  if(++count===3)time=20001;return args[0]==='ps'?id:JSON.stringify(record);
 }}),/ENGINE_TIMEOUT/);
});

const stats={id,cpu:'95.25%',memory:'512MiB / 1GiB',memoryPercent:'50.00%'};
const disk={id,project,writableBytes:1073741824,rootFilesystemBytes:2147483648};
function resourceRunner({statsText=JSON.stringify(stats),diskText=JSON.stringify(disk),after=id}={}){let census=0;return async args=>args[0]==='ps'?(++census===1?id:after):args[0]==='stats'?statsText:args.includes('--size')?diskText:JSON.stringify(record);}
test('opt-in resources report current container CPU memory and writable-layer thresholds without claiming data capacity or queue',async()=>{
 const calls=[],run=resourceRunner();const r=await diagnose({project,services:['api']},{resources:true,clock:()=>0,run:async(a,o)=>{calls.push([a,o]);return run(a,o);}});
 assert.equal(r.containerHealth,'healthy');assert.equal(r.resourceObservation.state,'observed');const m=r.resourceObservation.services[0].metrics;
 assert.deepEqual(m.cpu,{state:'observed',percentOneCore:95.25,alert:'warning'});assert.equal(m.memory.usedBytesEstimate,536870912);assert.equal(m.memory.limitBytesEstimate,1073741824);assert.equal(m.memory.alert,'normal');assert.equal(m.writableLayer.alert,'warning');
 assert.equal(r.resourceObservation.storageCapacity.state,'unknown');assert.equal(r.resourceObservation.queue.state,'unknown');assert.deepEqual(r.resourceObservation.errors,{state:'observed',scope:'current-container-history-not-error-rate',nonzeroExitContainers:0,restarts:2,alert:'normal'});
 assert.equal(calls.length,5);assert.deepEqual(calls.find(x=>x[0][0]==='stats')[0].slice(0,4),['stats','--no-stream','--no-trunc','--format']);
 for(const[a,o]of calls){assert(o.timeout<=8000);assert(!a.join(' ').includes('.Config.Env'));assert(!a.join(' ').includes('.Mounts'));assert(!a.join(' ').includes('exec'));}
});
test('resource observations reject malformed duplicate foreign IDs secret output and unsupported bytes instead of fabricating zeros',async()=>{
 for(const patch of [{id:id2},{cpu:'NaN%'},{memory:'0B / 0B'},{memory:'2GiB / 1GiB'},{memoryPercent:'101%'},{env:'synthetic-private-value'}])assert.throws(()=>parseResourceStats(JSON.stringify({...stats,...patch}),[id]),/ENGINE_OUTPUT_INVALID/);
 assert.throws(()=>parseResourceStats(JSON.stringify(stats)+'\n'+JSON.stringify(stats),[id,id2]),/ENGINE_OUTPUT_INVALID/);
 assert.throws(()=>parseResourceStats(JSON.stringify(stats).replace('"cpu":','"cpu":"0%","cpu":'),[id]),/ENGINE_OUTPUT_INVALID/);
 for(const patch of [{project:'other'},{writableBytes:-1},{writableBytes:'1'},{rootFilesystemBytes:0},{path:'/private/secret'}])assert.throws(()=>parseWritableStorage(JSON.stringify({...disk,...patch}),id,project),/ENGINE_OUTPUT_INVALID/);
 const r=await diagnose({project,services:['api']},{resources:true,clock:()=>0,run:resourceRunner({statsText:'synthetic-secret',diskText:'synthetic-secret'})});assert.equal(r.resourceObservation.state,'partial');assert.equal(r.resourceObservation.services[0].metrics.cpu.state,'unknown');assert(!JSON.stringify(r).includes('synthetic-secret'));
});
test('resource census drift clears numeric metrics and metric deadline preserves original final census budget',async()=>{
 const changed=await diagnose({project,services:['api']},{resources:true,clock:()=>0,run:resourceRunner({after:''})});assert.equal(changed.containerHealth,'unknown');assert.equal(changed.resourceObservation.state,'unknown');assert.deepEqual(changed.resourceObservation.services,[]);
 let time=0;const run=resourceRunner();const delayed=await diagnose({project,services:['api']},{resources:true,clock:()=>time,run:async(a,o)=>{const result=await run(a,o);if(a[0]==='stats')time=6000;return result;}});assert.equal(delayed.resourceObservation.state,'partial');assert.equal(delayed.containerHealth,'healthy');
 const calls=[];await diagnose({project,services:['api']},{resources:true,clock:()=>0,run:async a=>{calls.push(a);return a[0]==='ps'?'':JSON.stringify(record);}});assert.equal(calls.length,2);assert(!calls.some(a=>a[0]==='stats'));
});
