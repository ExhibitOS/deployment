// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {planSelfhost,applySelfhost} from '../src/manager-selfhost.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-selfhost-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'bundle'),{mode:0o700});
 const image=`ghcr.io/exhibitos/platform@sha256:${'a'.repeat(64)}`,db=`postgres@sha256:${'b'.repeat(64)}`;
 const compose=JSON.stringify({name:'exhibitos-fixture',services:{platform:{image},database:{image:db}}});
 const manifest=JSON.stringify({schemaVersion:'1.0.0-draft.1',protocolVersion:'1',preferredEngine:'docker',projectName:'exhibitos-fixture',composeSha256:digest(compose),services:['platform','database'],images:[{reference:image},{reference:db}],ports:[13200],openUrl:'http://127.0.0.1:13200',readinessUrl:'http://127.0.0.1:13200/api/v1/readiness'});
 const oed=JSON.stringify({schemaVersion:'1.0.0-draft.1',kind:'deployment',id:'70000000-0000-4000-8000-000000000001',createdAt:'2026-10-08T00:00:00Z',target:{type:'local-compose'},runtime:{image,httpPort:13200,replicas:1},storage:{metadata:{type:'postgresql',host:'database',port:5432,database:'exhibitos',user:'exhibitos',passwordSecretRef:'database-password'},assets:{type:'filesystem',path:'data/assets'}},secretRefs:[{id:'database-password',source:'environment',variable:'EXHIBITOS_DATABASE_PASSWORD'}]});
 const manager='synthetic executable bytes';
 for(const [name,bytes,mode] of [['bundle/manifest.json',manifest,0o600],['bundle/compose.yaml',compose,0o600],['runtime.env','SYNTHETIC_PASSWORD=never-output\n',0o600],['oed.json',oed,0o600],['manager',manager,0o700]])await writeFile(join(root,name),bytes,{mode});
 const calls=[],env={PATH:'/qualified/bin',DOCKER_CONTEXT:'fixture',DOCKER_TLS_VERIFY:'1'};
 const run=async(args,options)=>{calls.push({args,env:options.env});if(args[0]==='context')return JSON.stringify('unix:///synthetic/docker.sock');return '';};
 return {root,calls,env,run,input:{root,oedPath:join(root,'oed.json'),managerPath:join(root,'manager'),approved:{oedSha256:digest(oed),manifestSha256:digest(manifest),composeSha256:digest(compose),managerSha256:digest(manager)}}};
}
test('plan is read-only; explicit cached Install uses pinned child environment and consumes genuine capability',async t=>{
 const f=await fixture(t),before=await readFile(join(f.root,'runtime.env'));const plan=await planSelfhost(f.input,{run:f.run,getEnvironment:()=>f.env});
 assert.equal(plan.mode,'fresh');assert.equal(JSON.stringify(plan).includes('never-output'),false);
 let calls=0;const result=await applySelfhost(plan,{action:'install',preserveVolumes:true,existingImagesOnly:true},{managerRun:async(path,args,env)=>{calls++;assert.equal(path,f.input.managerPath);assert.deepEqual(args.slice(2),['install-existing-images','--preserve-volumes','--existing-images-only']);assert.equal(env.DOCKER_HOST,'unix:///synthetic/docker.sock');assert.equal(env.DOCKER_CONTEXT,undefined);assert.equal(env.DOCKER_TLS_VERIFY,undefined);return JSON.stringify({id:'70000000-0000-4000-8000-000000000002',action:'install',cachedImagesOnly:true,state:'completed',attempt:1,errorCode:null});}});
 assert.equal(result.state,'completed');assert.equal(calls,1);assert.deepEqual(await readFile(join(f.root,'runtime.env')),before);
 await assert.rejects(()=>applySelfhost(plan,{action:'install',preserveVolumes:true,existingImagesOnly:true}),{code:'SELFHOST_CONSENT_REQUIRED'});
 assert.ok(f.calls.filter(c=>c.args.includes('ps')).every(c=>c.args[0]==='--host'));
});
test('changed private environment, forged plan and missing consent never execute child',async t=>{
 const f=await fixture(t),plan=await planSelfhost(f.input,{run:f.run,getEnvironment:()=>f.env});
 await writeFile(join(f.root,'runtime.env'),'changed\n');
 const options={managerRun:()=>assert.fail('no child allowed')},consent={action:'install',preserveVolumes:true,existingImagesOnly:true};
 await assert.rejects(()=>applySelfhost(plan,consent,options),{code:'SELFHOST_SOURCE_CHANGED'});
 await assert.rejects(()=>applySelfhost({...plan},consent,options),{code:'SELFHOST_CONSENT_REQUIRED'});
});
test('remote endpoint, nonfresh census and approval mismatch refuse before mutations',async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>planSelfhost(f.input,{run:f.run,getEnvironment:()=>({DOCKER_HOST:'tcp://localhost:2375'})}),{code:'SELFHOST_PLAN_REFUSED'});
 await assert.rejects(()=>planSelfhost({...f.input,approved:{...f.input.approved,oedSha256:'c'.repeat(64)}},{run:f.run,getEnvironment:()=>f.env}),{code:'SELFHOST_APPROVAL_MISMATCH'});
 await assert.rejects(()=>planSelfhost(f.input,{run:async(args,opts)=>args.includes('ps')?'d'.repeat(64):f.run(args,opts),getEnvironment:()=>f.env}),{code:'SELFHOST_PROJECT_NOT_FRESH'});
});
test('context drift and private binding tamper refuse before CLI; no old receipt grants mutation',async t=>{
 const f=await fixture(t),plan=await planSelfhost(f.input,{run:f.run,getEnvironment:()=>f.env});f.env.DOCKER_CONTEXT='changed';
 await assert.rejects(()=>applySelfhost(plan,{action:'install',preserveVolumes:true,existingImagesOnly:true},{managerRun:()=>assert.fail('no child allowed')}),{code:'SELFHOST_OPERATION_UNCERTAIN'});
 f.env.DOCKER_CONTEXT='fixture';const second=await planSelfhost(f.input,{run:f.run,getEnvironment:()=>f.env});
 await writeFile(join(f.root,'deployment-binding.json'),'{}',{mode:0o600});
 await assert.rejects(()=>applySelfhost(second,{action:'install',preserveVolumes:true,existingImagesOnly:true},{managerRun:()=>assert.fail('no child allowed')}),{code:'SELFHOST_SOURCE_CHANGED'});
});

test('completed child result cannot bless configuration drift or an unbounded job identifier',async t=>{
 const f=await fixture(t),plan=await planSelfhost(f.input,{run:f.run,getEnvironment:()=>f.env});
 await assert.rejects(()=>applySelfhost(plan,{action:'install',preserveVolumes:true,existingImagesOnly:true},{managerRun:async()=>{await writeFile(join(f.root,'runtime.env'),'changed-during-child\n');return JSON.stringify({id:'70000000-0000-4000-8000-000000000002',action:'install',cachedImagesOnly:true,state:'completed',attempt:1});}}),{code:'SELFHOST_SOURCE_CHANGED'});
 assert.equal(JSON.stringify(plan).includes('changed-during-child'),false);
});

test('malformed or downgraded Install job response is refused while private binding is retained',async t=>{
 const f=await fixture(t),plan=await planSelfhost(f.input,{run:f.run,getEnvironment:()=>f.env});
 await assert.rejects(()=>applySelfhost(plan,{action:'install',preserveVolumes:true,existingImagesOnly:true},{managerRun:async()=>JSON.stringify({id:'70000000-0000-4000-8000-000000000002',action:'install',cachedImagesOnly:false,state:'completed',attempt:1})}),{code:'SELFHOST_MANAGER_RESPONSE_INVALID'});
 const binding=JSON.parse((await readFile(join(f.root,'deployment-binding.json'))).toString());assert.equal(binding.project,'exhibitos-fixture');
 const fresh=await planSelfhost(f.input,{run:f.run,getEnvironment:()=>f.env});assert.equal(fresh.mode,'existing');
 await assert.rejects(()=>applySelfhost(fresh,{action:'retry',preserveVolumes:true,existingImagesOnly:true},{managerRun:async()=>JSON.stringify({id:'unbounded-invalid-identifier',action:'install',cachedImagesOnly:true,state:'completed',attempt:1})}),{code:'SELFHOST_MANAGER_RESPONSE_INVALID'});
});
