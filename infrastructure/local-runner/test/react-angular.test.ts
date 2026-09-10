import test from 'node:test';
import assert from 'node:assert/strict';
import {reactAngularRuntimes} from '../react-angular.js';
// Pure format/security tests. Actual framework compilation needs the Docker image.
// @ts-expect-error The trusted image's plain-JS validator is intentionally shared as data logic only.
import {parseProject,previewDocument,PREVIEW_LIMIT} from '../images/frontend-frameworks/project.mjs';

test('React/Angular source formats accept only the two fixed text files',()=>{
  for(const definition of reactAngularRuntimes){
    const project=parseProject(definition.sample,definition.id);assert.equal(project.runtime,definition.id);
    for(const files of [{...project.files,'../evil.ts':'x'},{...project.files,'package.json':'{}'},{...project.files,'style.css':null}])assert.throws(()=>parseProject(JSON.stringify({...project,files}),definition.id));
    assert.throws(()=>parseProject(JSON.stringify({...project,command:'npm install'}),definition.id));
    assert.throws(()=>parseProject(definition.sample,definition.id==='react'?'angular':'react'));
    assert.throws(()=>parseProject(JSON.stringify({...project,files:{...project.files,'style.css':'é'.repeat(15000)}}),definition.id));
    assert.throws(()=>parseProject(JSON.stringify({...project,files:{...project.files,'style.css':'\0'}}),definition.id));
  }
});
test('preview artifact is bounded, has no eval grant and escapes closing script/style tags',()=>{
  const html=previewDocument('react','console.log("</script>")','/* </style> */');
  assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/unsafe-eval/);
  assert.equal((html.match(/<\/script>/g)||[]).length,1);assert.equal((html.match(/<\/style>/g)||[]).length,1);
  assert.throws(()=>previewDocument('angular','a'.repeat(PREVIEW_LIMIT),''));
});
