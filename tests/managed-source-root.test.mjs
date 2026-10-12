// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {resolveManagedSourceRoot} from '../src/ssh-maintenance.mjs';
import {executeRemoteMaintenance} from '../src/ssh-maintenance.mjs';
const profile='/home/fixture/profile',source='c9744fd3-8fa5-438b-b65a-9adff0dea697',recovery='822a3bed-1000-4000-8000-000000000001';
const registry={format:1,activeId:recovery,installations:[{id:source,kind:'default',createdAt:1},{id:recovery,kind:'recovery',createdAt:2}]};
test('native default UUID routes to local-runtime while explicit recovery UUID retains its own root',()=>{
 assert.equal(resolveManagedSourceRoot(profile,source,registry),join(profile,'local-runtime'));
 assert.equal(resolveManagedSourceRoot(profile,recovery,registry),join(profile,'installations',recovery));
 assert.equal(registry.activeId,recovery,'Original source routing must remain valid after target selection');
});
test('aliases unregistered IDs malformed native registries and caller paths never grant source routing',()=>{
 for(const id of ['default','../local-runtime','70000000-0000-4000-8000-000000000099','00000000-0000-0000-0000-000000000000'])assert.throws(()=>resolveManagedSourceRoot(profile,id,registry),e=>e.code==='SSH_SOURCE_REGISTRY_INVALID');
 for(const change of [r=>r.format=2,r=>r.activeId='70000000-0000-4000-8000-000000000099',r=>r.installations.push({...r.installations[0]}),r=>r.installations[1].kind='default',r=>r.installations[0].kind='recovery',r=>r.installations[0].kind='override',r=>r.installations[0].path='/foreign',r=>r.installations[0].createdAt=-1,r=>r.installations[0].createdAt=8640000000000001,r=>r.installations=[]]){
  const bad=structuredClone(registry);change(bad);assert.throws(()=>resolveManagedSourceRoot(profile,source,bad),e=>e.code==='SSH_SOURCE_REGISTRY_INVALID');
 }
 for(const path of ['relative','/home/fixture/profile/../other'])assert.throws(()=>resolveManagedSourceRoot(path,source,registry),e=>e.code==='SSH_SOURCE_REGISTRY_INVALID');
});
test('existing remote update status uses native registry kind and refuses mismatched roots before replay',()=>{
 const operation='70000000-0000-4000-8000-000000000002',updatePath='/home/fixture/bin/update';
 for(const id of [source,recovery]){
  const root=resolveManagedSourceRoot(profile,id,registry),calls=[];
  const observed={trust:{generation:4},intent:{update:{stage:'recovery_required',plan:{operationId:operation,sourceInstance:id}}}};
  const dependencies={fs:{realpathSync:p=>p,lstatSync:()=>({isDirectory:()=>true,mode:0o700})},execFileSync:(path,args)=>{calls.push(args[0]);assert.equal(path,updatePath);assert.equal(args[0],'update-intent','Status never replays an update');return Buffer.from(JSON.stringify(observed));},join,read:p=>p.endsWith('installation-selection.json')?Buffer.from(JSON.stringify(registry)):Buffer.from('approved executable'),ancestors:()=>{},sha:()=> 'a'.repeat(64),fail:code=>{throw Object.assign(Error(code),{code});},boundedJSON:JSON.parse,uuid:v=>/^[a-f0-9-]{36}$/.test(v),hash:v=>/^[a-f0-9]{64}$/.test(v),resolveSourceRoot:resolveManagedSourceRoot};
  const input={action:'update-status',remoteRoot:root,maintenance:{profilePath:profile,updatePath,updateSha256:'a'.repeat(64),operationId:operation,expectedGeneration:4}};
  assert.equal(executeRemoteMaintenance(input,dependencies).state,'recovery_required');assert.deepEqual(calls,['update-intent','update-intent']);
  assert.throws(()=>executeRemoteMaintenance({...input,remoteRoot:root+'/foreign'},dependencies),e=>e.code==='SSH_UPDATE_SOURCE_MISMATCH');assert.equal(calls.length,3,'Mismatch refuses before a second observation or mutation');
 }
});
