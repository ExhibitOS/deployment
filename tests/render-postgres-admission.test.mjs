// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreePostgres} from '../src/pages-render.mjs';
const request={workspaceId:'tea-synthetic',projectName:'recovery-synthetic'};
const db={id:'dpg-synthetic',name:'recovery-synthetic-db',owner:{id:'tea-synthetic'},plan:'free',region:'frankfurt',version:'18',status:'available',expiresAt:'2099-01-01T00:00:00Z'};
const reply=value=>new Response(JSON.stringify(value),{status:200});
function options(fetch){return {tokens:{render:'synthetic-not-token'},fetch};}
test('eligible selected candidate remains GET-only, with exact returned ID',async()=>{let calls=0;const result=await createFreePostgres({...request,postgresId:db.id},options(async(url,init)=>{calls++;assert.equal(init.method,'GET');assert(url.endsWith('/'+db.id));return reply(db);}));assert.equal(result.id,db.id);assert.equal(calls,1);});
test('same-name retry reuses existing creating candidate without another POST',async()=>{let posts=0;const result=await createFreePostgres(request,options(async(url,init)=>{if(init.method==='POST')posts++;return reply([{postgres:{...db,status:'creating'}}]);}));assert.equal(result.id,db.id);assert.equal(result.status,'creating');assert.equal(posts,0);});
test('candidate appearing between name query and quota query is reused without POST',async()=>{let gets=0,posts=0;const result=await createFreePostgres(request,options(async(url,init)=>{if(init.method==='POST')posts++;gets++;return reply(gets===1?[]:[{postgres:db}]);}));assert.equal(result.id,db.id);assert.equal(gets,2);assert.equal(posts,0);});
test('another active free PG blocks creation before any POST',async()=>{let gets=0,posts=0;await assert.rejects(createFreePostgres(request,options(async(url,init)=>{if(init.method==='POST')posts++;gets++;return reply(gets===1?[]:[{postgres:{...db,id:'dpg-original',name:'original-source-db'}}]);})),/^Error: HOSTED_RESOURCE_CONFLICT$/);assert.equal(posts,0);});
test('lost POST response discovers the same candidate and never repeats POST',async()=>{let gets=0,posts=0;const result=await createFreePostgres(request,options(async(url,init)=>{if(init.method==='POST'){posts++;throw Error('synthetic lost response');}gets++;return reply(gets<=2?[]:[{postgres:db}]);}));assert.equal(result.id,db.id);assert.equal(posts,1);assert.equal(gets,3);});
test('foreign, wrong ID, paid, expired, wrong PG version and unknown status fail without POST',async()=>{for(const changed of [{owner:{id:'tea-other'}},{id:'dpg-other'},{plan:'basic_256mb'},{expiresAt:'2000-01-01T00:00:00Z'},{version:'17'},{status:'unknown'},{expiresAt:'invalid'}]){let posts=0;await assert.rejects(createFreePostgres({...request,postgresId:db.id},options(async(url,init)=>{if(init.method==='POST')posts++;return reply({...db,...changed});})),/^Error: HOSTED_/);assert.equal(posts,0);}});
test('new candidate request keeps existing free-only body and validates returned owner/version',async()=>{let posts=0;const result=await createFreePostgres(request,options(async(url,init)=>{if(init.method==='GET')return reply([]);posts++;const body=JSON.parse(init.body);assert.equal(body.ownerId,request.workspaceId);assert.equal(body.plan,'free');assert.equal(body.version,'18');assert.equal(body.enableHighAvailability,false);assert.equal(body.enableDiskAutoscaling,false);assert.deepEqual(body.ipAllowList,[]);return reply(db);}));assert.equal(result.id,db.id);assert.equal(posts,1);});

test('unknown workspace quota rows cannot be interpreted as a free slot',async()=>{for(const change of [{owner:undefined},{plan:undefined},{id:undefined}]){let calls=0,posts=0;await assert.rejects(createFreePostgres(request,options(async(url,init)=>{if(init.method==='POST')posts++;calls++;return reply(calls===1?[]:[{postgres:{...db,...change}}]);})),/^Error: HOSTED_RESPONSE_INVALID$/);assert.equal(posts,0);}});

test('authoritatively expired retained source permits one free POST without changing original',async()=>{
 const original={...db,id:'dpg-original',name:'original-source-db',status:'suspended',expiresAt:'2000-01-01T00:00:00Z'},before=JSON.stringify(original);let gets=0,posts=0;
 const result=await createFreePostgres(request,options(async(url,init)=>{if(init.method==='POST'){posts++;assert.equal(JSON.parse(init.body).plan,'free');return reply({...db,status:'creating'});}gets++;return reply(gets===1?[]:[{postgres:original}]);}));
 assert.equal(result.id,db.id);assert.equal(result.status,'creating');assert.equal(posts,1);assert.equal(JSON.stringify(original),before);
});
test('missing or invalid expiry and unknown status never prove an inactive quota slot',async()=>{
 for(const change of [{expiresAt:undefined,status:'available'},{expiresAt:undefined,status:'suspended'},{expiresAt:'invalid'},{status:'unknown',expiresAt:'2000-01-01T00:00:00Z'},{status:undefined,expiresAt:'2000-01-01T00:00:00Z'}]){
  let gets=0,posts=0;await assert.rejects(createFreePostgres(request,options(async(url,init)=>{if(init.method==='POST')posts++;gets++;return reply(gets===1?[]:[{postgres:{...db,id:'dpg-original',name:'original-source-db',...change}}]);})),/^Error: HOSTED_/);assert.equal(posts,0);
 }
});
test('same-operation expired resource is never silently replaced even when suspended',async()=>{
 for(const selected of [false,true]){let posts=0;await assert.rejects(createFreePostgres({...request,...(selected?{postgresId:db.id}:{})},options(async(url,init)=>{if(init.method==='POST')posts++;const expired={...db,status:'suspended',expiresAt:'2000-01-01T00:00:00Z'};return reply(selected?expired:[{postgres:expired}]);})),/^Error: HOSTED_RECOVERY_DATABASE_EXPIRED$/);assert.equal(posts,0);}
});
