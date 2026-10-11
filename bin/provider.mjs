#!/usr/bin/env node
// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {readFile} from 'node:fs/promises';
import {boundedJSON} from '../src/bounded-json.mjs';
import {dryRun,prepareProviderWorkspace,OpenTofuProvider} from '../src/provider-adapter.mjs';
try{
 const [action,file,...extra]=process.argv.slice(2);if(extra.length||!['dry-run','prepare','plan','status','apply','destroy'].includes(action)||!file)throw Error('PROVIDER_USAGE');
 const config=boundedJSON(await readFile(file,'utf8'),16384);if(!config||Object.keys(config).some(k=>!['target','cost','workspace','binary','binarySha256'].includes(k)))throw Error('PROVIDER_CONFIGURATION_INVALID');
 let result;
 if(action==='dry-run')result=dryRun(config.target,config.cost);
 else if(action==='prepare')result=await prepareProviderWorkspace(config.workspace,config.target);
 else if(action==='apply'||action==='destroy')throw Error('PROVIDER_INITIAL_ZERO_COST_UNVERIFIED');
 else{const provider=new OpenTofuProvider(config);result=action==='status'?await provider.status():await provider.plan(config.target,{cost:config.cost});}
 console.log(JSON.stringify(result));
}catch(error){const code=/^PROVIDER_[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_FAILED';console.error(JSON.stringify({code,credentialsIncluded:false}));process.exitCode=1;}
