#!/usr/bin/env node
// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {diagnose,safeError,DiagnosticError} from '../src/diagnostics.mjs';
import {diagnoseApplication} from '../src/application-readiness.mjs';
try{
 const args=process.argv.slice(2);
 if(![4,5,6].includes(args.length)||args[0]!=='--project'||args[2]!=='--services')throw new DiagnosticError('USAGE');
 if(args.length===5&&args[4]!=='--resources'||args.length===6&&args[4]!=='--application-readiness')throw new DiagnosticError('USAGE');
 const target={project:args[1],services:args[3].split(',')};const resourceMode=args.length===5;const result=args.length===6&&!resourceMode?await diagnoseApplication(target,{service:args[5]}):await diagnose(target,{resources:resourceMode});
 console.log(JSON.stringify(result));process.exitCode=result.containerHealth==='healthy'&&(args.length===4||(resourceMode?result.resourceObservation.state==='observed':result.applicationReadiness==='ready'))?0:result.containerHealth==='unhealthy'?1:2;
}catch(e){console.log(JSON.stringify(safeError(e)));process.exitCode=3;}
