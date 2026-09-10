import {stat} from 'node:fs/promises';
import {PREVIEW_LIMIT} from './project.mjs';
const file=await stat('/tmp/preview.html');
if(!file.isFile()||file.size<1||file.size>PREVIEW_LIMIT)throw new Error('Aperçu absent ou trop grand.');
// Bootstrap's common marker proves the compiler completed; browser interaction is
// verified separately. It does not claim this text came from the student app.
console.log('Bonjour!');
