// Copyright 2026 ExhibitOS contributors. SPDX-License-Identifier: Apache-2.0
import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {boundedJSON} from '../src/bounded-json.mjs';
import {planSsh,applySsh,verifySshEndpoint,rollbackSsh} from '../src/generic-ssh.mjs';
try{
 const [command,file]=process.argv.slice(2);if(process.argv.length!==4||!['plan','install','start','stop','restart','retry','status','logs','verify','rollback'].includes(command)||!isAbsolute(file))throw Error('SSH_USAGE');
 if(typeof process.getuid!=='function'||process.platform==='win32')throw Error('SSH_CLIENT_UNSUPPORTED');
 const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>131072)throw Error('SSH_CONFIG_UNSAFE');const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let config;try{const bytes=await fd.readFile(),after=await fd.stat(),named=await lstat(file);if(bytes.length>131072||['dev','ino','mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].some(k=>s[k]!==after[k]||s[k]!==named[k]))throw Error('SSH_CONFIG_CHANGED');config=boundedJSON(bytes.toString('utf8'),131072);}finally{await fd.close();}
 if(!config||Object.keys(config).sort().join(',')!=='consent,connection,oed'||typeof config.consent!=='boolean')throw Error('SSH_CONFIG_INVALID');let result;
 if(command==='rollback')rollbackSsh();else if(command==='verify')result=await verifySshEndpoint(config.oed,config.connection);else {const plan=await planSsh(config.oed,config.connection);result=command==='plan'?plan:await applySsh(plan,{action:command,preserveVolumes:config.consent,existingImagesOnly:config.consent});}
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(e){const code=/^SSH_[A-Z_]+$/.test(e.code??e.message??'')?(e.code??e.message):'SSH_OPERATION_REFUSED';process.stderr.write(code+'\n');process.exitCode=1;}
