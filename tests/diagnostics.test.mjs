// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';import assert from 'node:assert/strict';
import {diagnose,parseIds,parseInspection,validateTarget,safeError,DiagnosticError} from '../src/diagnostics.mjs';
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
