// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {boundedJSON} from './bounded-json.mjs';
import {bindLocalEngine} from './engine-locality.mjs';
import {dockerRead,parseIds} from './diagnostics.mjs';
const leases=new WeakMap(),sha=b=>createHash('sha256').update(b).digest('hex');
const uuidRE=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hashRE=/^[a-f0-9]{64}$/,recordName='deployment-binding.json';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const closed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const identity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
async function privateDirectory(path){
 const s=await lstat(path,{bigint:true});
 if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777n)!==0o700n||s.uid!==BigInt(process.getuid())||await realpath(path)!==path)fail('SELFHOST_ROOT_UNSAFE');
 return s;
}
async function pinnedFile(path,limit,{privateMode=true,executable=false}={}){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await fd.stat({bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid())||before.size>BigInt(limit)||(privateMode&&(before.mode&0o777n)!==0o600n)||(executable&&(before.mode&0o022n)!==0n))fail('SELFHOST_FILE_UNSAFE');
  const bytes=await fd.readFile();
  if(bytes.length>limit||!same(before,await fd.stat({bigint:true}))||!same(before,await lstat(path,{bigint:true})))fail('SELFHOST_SOURCE_CHANGED');
  return {bytes,digest:sha(bytes)};
 }finally{await fd.close();}
}
function profile(oed,manifest,compose){
 if(!closed(oed,['schemaVersion','kind','id','createdAt','target','runtime','storage','secretRefs'])||oed.schemaVersion!=='1.0.0-draft.1'||oed.kind!=='deployment'||!closed(oed.target,['type'])||oed.target.type!=='local-compose'||!closed(oed.runtime,['image','httpPort','replicas'])||oed.runtime.replicas!==1||oed.runtime.httpPort!==13200||!/^.+@sha256:[a-f0-9]{64}$/.test(oed.runtime.image))fail('SELFHOST_PROFILE_UNSUPPORTED');
 const db=oed.storage?.metadata,assets=oed.storage?.assets;
 if(!closed(oed.storage,['metadata','assets'])||!closed(db,['type','host','port','database','user','passwordSecretRef'])||db.type!=='postgresql'||db.host!=='database'||db.port!==5432||db.database!=='exhibitos'||db.user!=='exhibitos'||!closed(assets,['type','path'])||assets.type!=='filesystem'||assets.path!=='data/assets'||!Array.isArray(oed.secretRefs)||oed.secretRefs.length!==1||!closed(oed.secretRefs[0],['id','source','variable'])||oed.secretRefs[0].id!==db.passwordSecretRef||oed.secretRefs[0].source!=='environment'||!/^EXHIBITOS_[A-Z0-9_]{1,64}$/.test(oed.secretRefs[0].variable))fail('SELFHOST_PROFILE_UNSUPPORTED');
 if(manifest.preferredEngine!=='docker'||manifest.schemaVersion!=='1.0.0-draft.1'||manifest.protocolVersion!=='1'||manifest.projectName!==compose.name||!/^exhibitos-[a-z0-9-]{1,38}$/.test(manifest.projectName)||manifest.composeSha256!==sha(Buffer.from(compose.bytes))||JSON.stringify(manifest.services)!==JSON.stringify(['platform','database'])||JSON.stringify(manifest.ports)!=='[13200]'||manifest.openUrl!=='http://127.0.0.1:13200'||manifest.readinessUrl!=='http://127.0.0.1:13200/api/v1/readiness'||!Array.isArray(manifest.images)||manifest.images.length!==2||manifest.images[0].reference!==oed.runtime.image||compose.services?.platform?.image!==oed.runtime.image||compose.services?.database?.image!==manifest.images[1].reference||!/^.+@sha256:[a-f0-9]{64}$/.test(manifest.images[1].reference))fail('SELFHOST_BUNDLE_MISMATCH');
}
async function jobSnapshot(root){
 try{const file=await pinnedFile(join(root,'jobs.json'),4*1024*1024),jobs=boundedJSON(file.bytes.toString(),4*1024*1024);if(!Array.isArray(jobs)||jobs.length>10000)fail('SELFHOST_JOB_INVALID');return {digest:file.digest,jobs};}
 catch(error){if(error.code!=='ENOENT')throw error;return {digest:null,jobs:[]};}
}
async function managerState(root){
 const state={};
 for(const name of ['engine.json','installed.json']){
  try{const file=await pinnedFile(join(root,name),65536);state[name]=file.digest;const value=boundedJSON(file.bytes.toString(),65536);if(name==='engine.json'&&value!=='docker')fail('SELFHOST_ENGINE_MISMATCH');}
  catch(error){if(error.code!=='ENOENT')throw error;state[name]=null;}
 }state['jobs.json']=(await jobSnapshot(root)).digest;return state;
}
async function census(engine,project){
 const ids=parseIds(await engine.run(['ps','--all','--no-trunc','--filter',`label=com.docker.compose.project=${project}`,'--format','{{.ID}}'],{timeout:8000}));
 const owned=parseIds(await engine.run(['ps','--all','--no-trunc','--filter',`label=com.exhibitos.project=${project}`,'--format','{{.ID}}'],{timeout:8000}));
 const resources=[];
 for(const kind of ['volume','network'])for(const label of ['com.docker.compose.project','com.exhibitos.project']){
  const text=await engine.run([kind,'ls','--filter',`label=${label}=${project}`,'--format','{{.Name}}'],{timeout:8000});
  if(typeof text!=='string'||Buffer.byteLength(text)>65536)fail('SELFHOST_CENSUS_INVALID');
  const names=text.trim()?text.trim().split(/\r?\n/):[];
  if(names.length>64||names.some(n=>!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(n)))fail('SELFHOST_CENSUS_INVALID');
  resources.push(...names);
 }
 return {ids,owned,resources}; // Manager performs exact container/network/volume ownership admission under its operation lock.
}
/** Read-only plan over an explicitly approved, already prepared private Manager root. No root creation, secret interpolation or LifecycleService construction. */
export async function planSelfhost({root,oedPath,managerPath,approved},{run=dockerRead,getEnvironment=()=>process.env}={}){
 try{
  if(process.platform==='win32'||!closed(approved,['oedSha256','manifestSha256','composeSha256','managerSha256'])||Object.values(approved).some(h=>!hashRE.test(h)))fail('SELFHOST_ADMISSION_REQUIRED');
  root=resolve(root);oedPath=resolve(oedPath);managerPath=resolve(managerPath);
  const rootStat=await privateDirectory(root);await privateDirectory(join(root,'bundle'));
  const inputs={oed:await pinnedFile(oedPath,65536),manifest:await pinnedFile(join(root,'bundle/manifest.json'),65536),compose:await pinnedFile(join(root,'bundle/compose.yaml'),65536),manager:await pinnedFile(managerPath,32*1024*1024,{privateMode:false,executable:true}),environment:await pinnedFile(join(root,'runtime.env'),65536)};
  for(const [name,digest] of [['oed',approved.oedSha256],['manifest',approved.manifestSha256],['compose',approved.composeSha256],['manager',approved.managerSha256]])if(inputs[name].digest!==digest)fail('SELFHOST_APPROVAL_MISMATCH');
  const oed=boundedJSON(inputs.oed.bytes.toString(),65536),manifest=boundedJSON(inputs.manifest.bytes.toString(),65536),compose=boundedJSON(inputs.compose.bytes.toString(),65536);
  profile(oed,manifest,{...compose,bytes:inputs.compose.bytes.toString()});
  const state=await managerState(root),jobs=(await jobSnapshot(root)).jobs;
  const budget={deadline:performance.now()+20000};
  const budgetedRun=async(args,options={})=>{const left=budget.deadline-performance.now();if(left<=0)fail('SELFHOST_TIME_QUOTA');const text=await run(args,{...options,timeout:Math.min(8000,left)});if(performance.now()>budget.deadline)fail('SELFHOST_TIME_QUOTA');return text;};
  const engine=await bindLocalEngine(budgetedRun,getEnvironment),observed=await census(engine,manifest.projectName);await engine.verify();
  const binding={version:1,profile:'manager-local-selfhost-v1',rootDigest:sha(root),project:manifest.projectName,endpointDigest:engine.endpointDigest,...approved};
  let current=null;
  try{current=boundedJSON((await pinnedFile(join(root,recordName),65536)).bytes.toString(),65536);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(current&&JSON.stringify(current)!==JSON.stringify(binding))fail('SELFHOST_BINDING_CHANGED');
  if(!current&&(state['installed.json']||jobs.length||observed.ids.length||observed.owned.length||observed.resources.length))fail('SELFHOST_PROJECT_NOT_FRESH');
  const receipt=Object.freeze({...binding,mode:current?'existing':'fresh',secretValuesIncluded:false,releaseAuthenticityVerified:false,fullDeploymentQualified:false});
  leases.set(receipt,{root,oedPath,managerPath,inputs,rootStat,engine,budget,binding,current,state,jobs,project:manifest.projectName});return receipt;
 }catch(error){fail(error.code?.startsWith('SELFHOST_')?error.code:'SELFHOST_PLAN_REFUSED');}
}
function runManager(path,args,env,{timeout=120000}={}){return new Promise((resolve,reject)=>execFile(path,args,{env,shell:false,windowsHide:true,timeout,maxBuffer:262144,encoding:'utf8'},(error,stdout)=>error?reject(Object.assign(new Error('SELFHOST_MANAGER_FAILED'),{code:'SELFHOST_MANAGER_FAILED'})):resolve(stdout)));}
/** Every call needs a fresh genuine plan capability and exact consent. Only Manager owns jobs, progress, operation lock, retry and installation state. */
export async function applySelfhost(plan,{action,preserveVolumes,existingImagesOnly},{managerRun=runManager}={}){
 const lease=leases.get(plan);leases.delete(plan);
 if(!lease||!['install','start','stop','restart','retry'].includes(action)||preserveVolumes!==true||existingImagesOnly!==true)fail('SELFHOST_CONSENT_REQUIRED');
 try{
  const {root,engine,binding}=lease;
  const retry=action==='retry'?lease.jobs.at(-1):null;
  if(action==='retry'&&(!retry||!uuidRE.test(retry.id)||!['failed','interrupted'].includes(retry.state)||!['install','start','stop','restart'].includes(retry.action)||!Number.isInteger(retry.attempt)||retry.attempt<1||retry.attempt>=5||(retry.action==='install'&&retry.cachedImagesOnly!==true)))fail('SELFHOST_RETRY_POLICY_REQUIRED');lease.budget.deadline=performance.now()+180000;
  const remaining=()=>{const left=lease.budget.deadline-performance.now();if(left<=0)fail('SELFHOST_OPERATION_UNCERTAIN');return left;};
  if(!same(lease.rootStat,await privateDirectory(root)))fail('SELFHOST_SOURCE_CHANGED');
  for(const [name,path] of [['oed',lease.oedPath],['manifest',join(root,'bundle/manifest.json')],['compose',join(root,'bundle/compose.yaml')],['environment',join(root,'runtime.env')],['manager',lease.managerPath]])if((await pinnedFile(path,name==='manager'?32*1024*1024:65536,{privateMode:name!=='manager',executable:name==='manager'})).digest!==lease.inputs[name].digest)fail('SELFHOST_SOURCE_CHANGED');
  let current=null;try{current=boundedJSON((await pinnedFile(join(root,recordName),65536)).bytes.toString(),65536);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(JSON.stringify(current)!==JSON.stringify(lease.current))fail('SELFHOST_BINDING_CHANGED');
  if(JSON.stringify(await managerState(root))!==JSON.stringify(lease.state))fail('SELFHOST_SOURCE_CHANGED');
  const observed=await census(engine,lease.project);await engine.verify();
  if(!current){
   if(action!=='install'||observed.ids.length||observed.owned.length||observed.resources.length)fail('SELFHOST_PROJECT_NOT_FRESH');
   const fd=await open(join(root,recordName),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await fd.writeFile(JSON.stringify(binding));await fd.sync();}finally{await fd.close();}
   const dir=await open(root,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}
  }else if(action==='install')fail('SELFHOST_USE_MANAGER_RETRY');
  await engine.verify();
  if(!identity(lease.rootStat,await privateDirectory(root))||JSON.stringify(boundedJSON((await pinnedFile(join(root,recordName),65536)).bytes.toString(),65536))!==JSON.stringify(binding)||JSON.stringify(await managerState(root))!==JSON.stringify(lease.state))fail('SELFHOST_BINDING_CHANGED');
  const args=['--root',root,...(action==='install'?['install-existing-images','--preserve-volumes','--existing-images-only']:action==='retry'?['retry-existing-images',retry.id,String(retry.attempt),'--preserve-volumes','--existing-images-only']:[action])];
  const result=boundedJSON(await managerRun(lease.managerPath,args,engine.managerEnvironment(),{timeout:Math.min(120000,remaining())}),262144);
  if(typeof result?.id!=='string'||!uuidRE.test(result.id)||!['completed','failed'].includes(result.state)||!Number.isInteger(result.attempt)||result.attempt<1||result.attempt>4294967295||!['install','start','stop','restart'].includes(result.action)||(action!=='retry'&&result.action!==action)||(result.action==='install'&&result.cachedImagesOnly!==true))fail('SELFHOST_MANAGER_RESPONSE_INVALID');
  if(retry&&(result.id!==retry.id||result.attempt!==retry.attempt+1||result.action!==retry.action||Boolean(result.cachedImagesOnly)!==Boolean(retry.cachedImagesOnly)))fail('SELFHOST_JOB_CHANGED');
  const durable=(await jobSnapshot(root)).jobs.at(-1);if(!durable||JSON.stringify(durable)!==JSON.stringify(result))fail('SELFHOST_JOB_CHANGED');
  await engine.verify();
  if(!identity(lease.rootStat,await privateDirectory(root))||JSON.stringify(boundedJSON((await pinnedFile(join(root,recordName),65536)).bytes.toString(),65536))!==JSON.stringify(binding))fail('SELFHOST_BINDING_CHANGED');
  for(const [name,path] of [['oed',lease.oedPath],['manifest',join(root,'bundle/manifest.json')],['compose',join(root,'bundle/compose.yaml')],['environment',join(root,'runtime.env')],['manager',lease.managerPath]])if((await pinnedFile(path,name==='manager'?32*1024*1024:65536,{privateMode:name!=='manager',executable:name==='manager'})).digest!==lease.inputs[name].digest)fail('SELFHOST_SOURCE_CHANGED');
  remaining();
  return {version:1,action,jobId:result.id,state:result.state,attempt:result.attempt,code:typeof result.errorCode==='string'&&/^[A-Z0-9_]{1,64}$/.test(result.errorCode)?result.errorCode:null,preservedVolumes:true,automaticRollback:false,fullDeploymentQualified:false};
 }catch(error){fail(error.code?.startsWith('SELFHOST_')?error.code:'SELFHOST_OPERATION_UNCERTAIN');}
}
