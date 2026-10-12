// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {boundedJSON} from '../src/bounded-json.mjs';
import {planSsh,applySsh,verifySshEndpoint,rollbackSsh,maintenanceSsh} from '../src/generic-ssh.mjs';
const cancellation=new AbortController(),cancel=()=>cancellation.abort();
try{
 const [command,file]=process.argv.slice(2);if(process.argv.length!==4||!['plan','install','start','stop','restart','retry','status','logs','verify','rollback','backup','backup-jobs','update','update-status'].includes(command)||!isAbsolute(file))throw Error('SSH_USAGE');
 if(['backup','backup-jobs','update','update-status','rollback'].includes(command)){process.on('SIGTERM',cancel);process.on('SIGINT',cancel);}
 if(typeof process.getuid!=='function'||process.platform==='win32')throw Error('SSH_CLIENT_UNSUPPORTED');
 const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>131072)throw Error('SSH_CONFIG_UNSAFE');const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let config;try{const bytes=await fd.readFile(),after=await fd.stat(),named=await lstat(file);if(bytes.length>131072||['dev','ino','mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].some(k=>s[k]!==after[k]||s[k]!==named[k]))throw Error('SSH_CONFIG_CHANGED');config=boundedJSON(bytes.toString('utf8'),131072);}finally{await fd.close();}
 const maintenance=['backup','backup-jobs','update','update-status'].includes(command);
 if(!config||Object.keys(config).sort().join(',')!==(command==='rollback'?'connection,consent,oed,rollback':maintenance?'connection,consent,maintenance,oed':'connection,consent,oed')||typeof config.consent!=='boolean')throw Error('SSH_CONFIG_INVALID');let result;
 if(maintenance){const plan=await planSsh(config.oed,config.connection,{signal:cancellation.signal});result=await maintenanceSsh(plan,{action:command,input:config.maintenance,preserveVolumes:config.consent,externalWritersQuiesced:config.consent,appsClosed:config.consent,signal:cancellation.signal});}else if(command==='rollback'){const plan=await planSsh(config.oed,config.connection,{signal:cancellation.signal});result=await rollbackSsh(plan,{rollback:config.rollback,preserveVolumes:config.consent,externalWritersQuiesced:config.consent,appsClosed:config.consent,signal:cancellation.signal});}else if(command==='verify')result=await verifySshEndpoint(config.oed,config.connection);else {const plan=await planSsh(config.oed,config.connection,{signal:cancellation.signal});result=command==='plan'?plan:await applySsh(plan,{action:command,preserveVolumes:config.consent,existingImagesOnly:config.consent});}
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(e){const code=/^SSH_[A-Z_]+$/.test(e.code??e.message??'')?(e.code??e.message):'SSH_OPERATION_REFUSED';process.stderr.write(code+'\n');process.exitCode=1;}
finally{process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);}
