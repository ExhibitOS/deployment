// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const cli=fileURLToPath(new URL('../bin/generic-ssh.mjs',import.meta.url));
async function invoke(t,command,bytes,{mode=0o600}={}){
 const owned=await realpath(await mkdtemp(join(tmpdir(),'exhibitos-ssh-cli-fields-')));
 await chmod(owned,0o700);t.after(()=>rm(owned,{recursive:true,force:true}));
 const config=join(owned,'connection.json');await writeFile(config,bytes,{mode});
 // Null OED below fails the existing validator before any secret/provider/SSH/DNS/engine access.
 return spawnSync(process.execPath,[cli,command,config],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??'',LANG:'C',LC_ALL:'C'}});
}
test('genuine CLI admits its three closed config forms before existing OED validation',async t=>{
 for(const [command,config] of [['plan',{consent:true,connection:{},oed:null}],['rollback',{consent:true,connection:{},oed:null,rollback:null}],['backup-jobs',{consent:true,connection:{},maintenance:null,oed:null}]]){
  for(const value of [config,Object.fromEntries(Object.entries(config).reverse())]){
   const actual=await invoke(t,command,JSON.stringify(value));assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.equal(actual.stderr,'SSH_OED_INVALID\n');
  }
 }
});
test('genuine CLI still refuses unknown missing and nonboolean top fields',async t=>{
 for(const config of [{consent:true,connection:{},oed:null,unknown:null},{connection:{},oed:null},{consent:'true',connection:{},oed:null}]){
  const actual=await invoke(t,'plan',JSON.stringify(config));assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.equal(actual.stderr,'SSH_CONFIG_INVALID\n');
 }
});
test('genuine CLI retains duplicate-key parser byte depth and private-file bounds',async t=>{
 for(const bytes of ['{"consent":true,"consent":false,"connection":{},"oed":null}','{"consent":true,"connection":{},"oed":null,"__proto__":{}}',JSON.stringify({consent:true,connection:{},oed:[[[[[[[[[[[[[null]]]]]]]]]]]]]})]){
  const actual=await invoke(t,'plan',bytes);assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.equal(actual.stderr,'SSH_OPERATION_REFUSED\n');
 }
 const oversized=await invoke(t,'plan',' '.repeat(131073));assert.equal(oversized.status,1);assert.equal(oversized.stderr,'SSH_CONFIG_UNSAFE\n');
 const readable=await invoke(t,'plan','{"consent":true,"connection":{},"oed":null}',{mode:0o644});assert.equal(readable.status,1);assert.equal(readable.stderr,'SSH_CONFIG_UNSAFE\n');
});
