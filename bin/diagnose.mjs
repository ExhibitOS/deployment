#!/usr/bin/env node
// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {diagnose,safeError,DiagnosticError} from '../src/diagnostics.mjs';
try{
 const args=process.argv.slice(2);
 if(args.length!==4||args[0]!=='--project'||args[2]!=='--services')throw new DiagnosticError('USAGE');
 const result=await diagnose({project:args[1],services:args[3].split(',')});
 console.log(JSON.stringify(result));process.exitCode=result.containerHealth==='healthy'?0:result.containerHealth==='unhealthy'?1:2;
}catch(e){console.log(JSON.stringify(safeError(e)));process.exitCode=3;}
