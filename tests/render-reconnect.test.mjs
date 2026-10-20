// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {executeHosted} from '../src/pages-render.mjs';

// Public RFC 8032 test vector 1, encoded as PKCS8; no key generation occurs.
const signing=Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex').toString('base64');
const request={provider:'render',action:'connect-existing',workspaceId:'tea-synthetic',serviceId:'srv-synthetic',postgresId:'dpg-synthetic',projectName:'original-runtime-project'};
const origin='https://synthetic.onrender.com',internal='postgresql://synthetic:synthetic-private-password@dpg-synthetic-a/internal_db';
const envVars=[{key:'CLIENT_ORIGIN',value:'https://synthetic.pages.dev'},{key:'TENANT_ID',value:'10000000-0000-4000-8000-000000000001'},{key:'ADMIN_SUBJECT',value:'synthetic-owner'},{key:'ADMIN_PASSWORD',value:'synthetic-original-admin-password'},{key:'FREEZE_SIGNING_KEY_BASE64',value:signing}];
const pins=[{key:'STATIC_PUBLICATION_ID',value:'20000000-0000-4000-8000-000000000002'},{key:'STATIC_REVISION_SHA256',value:'b'.repeat(64)},{key:'STATIC_INDEX_SHA256',value:'c'.repeat(64)}];
function fixture(change={}){
 const calls=[],db={id:request.postgresId,owner:{id:request.workspaceId},plan:'free',version:'18',status:'available',expiresAt:'2099-01-01T00:00:00Z',...change.db};
 const service={id:request.serviceId,name:'renamed-service-not-the-original-project',ownerId:request.workspaceId,type:'web_service',repo:'https://github.com/ExhibitOS/platform',suspended:'not_suspended',serviceDetails:{plan:'free',runtime:'node',healthCheckPath:'/api/v1/readiness',url:origin,...change.details},...change.service};
 const options={tokens:{render:'synthetic-private-token'},runtime:{envVars:structuredClone(envVars)},fetch:async(url,init)=>{
  calls.push({url,method:init.method,redirect:init.redirect,body:init.body});
  const path=new URL(url).pathname;
  let value;
  if(path===`/v1/postgres/${request.postgresId}`)value=db;
  else if(path===`/v1/services/${request.serviceId}`)value=service;
  else if(path===`/v1/postgres/${request.postgresId}/connection-info`)value=change.info??{internalConnectionString:internal};
  else if(path===`/v1/services/${request.serviceId}/env-vars`)value=change.saved??[{envVar:{key:'DATABASE_URL',value:internal}},...(change.env??envVars).map(envVar=>({envVar}))];
  else throw Error('unexpected fixture endpoint');
  return new Response(change.raw??JSON.stringify(value),{status:change.status??200,headers:{'Content-Type':'application/json'}});
 }};
 return {calls,options};
}
function onlyRead(calls){assert(calls.every(c=>c.method==='GET'&&c.redirect==='error'&&c.body===undefined&&c.url.startsWith('https://api.render.com/v1/')));}
async function refused(f,code){await assert.rejects(executeHosted(request,f.options),new RegExp('^Error: '+code+'$'));onlyRead(f.calls);}

test('explicit existing connection uses exactly four GETs and returns only a public receipt',async()=>{
 for(const suspended of ['not_suspended','suspended']){
  const f=fixture({service:{suspended}}),before=JSON.stringify(f.options.runtime);
  const result=await executeHosted(request,f.options);
  assert.deepEqual(result,{provider:'render',action:'connect-existing',state:'ready',projectName:request.projectName,serviceId:request.serviceId,postgresId:request.postgresId,url:origin,expiresAt:'2099-01-01T00:00:00.000Z'});
  assert.deepEqual(f.calls.map(c=>new URL(c.url).pathname+new URL(c.url).search),[`/v1/postgres/${request.postgresId}`,`/v1/services/${request.serviceId}`,`/v1/postgres/${request.postgresId}/connection-info`,`/v1/services/${request.serviceId}/env-vars?limit=100`]);
  onlyRead(f.calls);assert.equal(JSON.stringify(f.options.runtime),before);
  for(const secret of [internal,signing,'synthetic-private-token','synthetic-original-admin-password'])assert(!JSON.stringify(result).includes(secret));
 }
});

test('missing/malformed original runtime environment refuses before provider GET and never creates values',async()=>{
 for(const candidate of [undefined,{},[],[...envVars,envVars[0]],[...envVars,pins[0]],envVars.filter(e=>e.key!=='ADMIN_PASSWORD'),envVars.map(e=>e.key==='FREEZE_SIGNING_KEY_BASE64'?{...e,value:'not-a-key'}:e)]){
  const f=fixture();f.options.runtime=candidate===undefined?undefined:{envVars:candidate};
  await refused(f,'HOSTED_RECOVERY_CONFIGURATION_REQUIRED');assert.equal(f.calls.length,0);
 }
});

test('explicit IDs and original project identifier are mandatory without name-based discovery',async()=>{
 for(const patch of [{workspaceId:undefined},{serviceId:undefined},{postgresId:undefined},{projectName:undefined},{projectName:'../other'},{serviceId:'srv/other'},{provider:'cloudflare'}]){
  const f=fixture();await assert.rejects(executeHosted({...request,...patch},f.options),/^Error: HOSTED_REQUEST_INVALID$/);assert.equal(f.calls.length,0);
 }
});

test('foreign or changed resource identities, paid plans, unsupported runtime and expired DB fail closed',async()=>{
 for(const change of [{db:{id:'dpg-other'}},{db:{owner:{id:'tea-other'}}},{service:{id:'srv-other'}},{service:{ownerId:'tea-other'}},{db:{version:'17'}},{db:{status:'creating'}},{service:{type:'static_site'}},{service:{repo:'https://example.invalid/private'}},{details:{runtime:'docker'}},{details:{healthCheckPath:'/wrong'}},{db:{plan:'basic'}},{details:{plan:'starter'}},{db:{expiresAt:'2000-01-01T00:00:00Z'}}]){
  await refused(fixture(change),'HOSTED_(RESOURCE_CONFLICT|PAID_PLAN_REFUSED|RECOVERY_DATABASE_EXPIRED)');
 }
});

test('database URL must occur exactly once and match the selected DB connection-info',async()=>{
 for(const info of [{},{internalConnectionString:42},{internalConnectionString:'https://example.invalid'}])await refused(fixture({info}),'HOSTED_RESPONSE_INVALID');
 for(const saved of [[],[{envVar:{key:'DATABASE_URL',value:internal+'-wrong'}}],...[2].map(n=>Array.from({length:n},()=>({envVar:{key:'DATABASE_URL',value:internal}})))])await refused(fixture({saved}),'HOSTED_RESOURCE_CONFLICT');
});

test('original private config, authority, optional publication pins and canonical origin must match',async()=>{
 for(const key of ['CLIENT_ORIGIN','TENANT_ID','ADMIN_SUBJECT','ADMIN_PASSWORD','FREEZE_SIGNING_KEY_BASE64']){
  const env=envVars.map(e=>e.key===key?{...e,value:e.value+'changed'}:e);await refused(fixture({env}),'HOSTED_RECOVERY_CONFIGURATION_CHANGED');
 }
 for(const env of [[...envVars,envVars[0]],[...envVars,...pins],[...envVars,{key:'AUTH_ORIGIN',value:'https://other.onrender.com'}]])await refused(fixture({env}),'HOSTED_RECOVERY_CONFIGURATION_CHANGED');
 for(const url of ['https://user:password@synthetic.onrender.com','https://synthetic.onrender.com/other','https://synthetic.onrender.com/?secret=x','https://synthetic.invalid'])await refused(fixture({details:{url}}),'HOSTED_RECOVERY_CONFIGURATION_REQUIRED');
 const f=fixture({env:[...envVars,...pins]});f.options.runtime.envVars.push(...pins);assert.equal((await executeHosted(request,f.options)).state,'ready');onlyRead(f.calls);
});

test('provider denial, redirects and malformed/oversized bodies remain fixed redacted errors',async()=>{
 for(const [status,code] of [[401,'HOSTED_TOKEN_INVALID'],[403,'HOSTED_PERMISSION_REQUIRED'],[302,'HOSTED_REDIRECT_REFUSED'],[500,'HOSTED_REMOTE_REJECTED']])await refused(fixture({status} ),code);
 for(const raw of ['not-json',' '.repeat(4*1024*1024+1)])await refused(fixture({raw}),'HOSTED_RESPONSE_INVALID');
 const f=fixture();f.options.fetch=async()=>{throw Error(internal);};await refused(f,'HOSTED_CONNECTION_FAILED');
});
