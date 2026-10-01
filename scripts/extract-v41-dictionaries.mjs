// Parse literal defaults only; never execute the reference bookmarklet.
import ts from 'typescript';
import fs from 'node:fs';
import crypto from 'node:crypto';
const filename=process.argv[2]||'artifacts/v41-reference/readable.js';
const source=fs.readFileSync(filename,'utf8');
const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
function literal(node){
 if(ts.isStringLiteral(node)||ts.isNumericLiteral(node))return ts.isNumericLiteral(node)?Number(node.text):node.text;
 if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.map(p=>{if(!ts.isPropertyAssignment(p)||!p.name||!('text' in p.name))throw Error('Nonliteral property');return [p.name.text,literal(p.initializer)];}));
 if(ts.isArrayLiteralExpression(node))return node.elements.map(literal);
 throw Error('Nonliteral reference default: '+node.kind);
}
const defaults={};function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&['KEY_LABELS','CODE_SEED'].includes(node.name.text))defaults[node.name.text]=literal(node.initializer);ts.forEachChild(node,visit);}visit(tree);
if(!defaults.KEY_LABELS||!defaults.CODE_SEED)throw Error('Reference defaults missing');
fs.writeFileSync('native/pce/dictionary_seed.py','# Generated from v4.1 literal dictionaries. No reference code is executed.\n# Source SHA256 '+crypto.createHash('sha256').update(source).digest('hex')+'\nimport json\n\nDEFAULTS = json.loads('+JSON.stringify(JSON.stringify(defaults))+')\n','utf8');
console.log({keys:Object.keys(defaults.KEY_LABELS).length,codeFields:Object.keys(defaults.CODE_SEED).length});
