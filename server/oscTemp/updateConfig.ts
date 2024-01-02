/// This script is a simple helper to create two esLint configurations for us.  One will be stylistic only, the other will combine style and function rules
/// the stylistic only will be used for formatting within the plugin
/// The combined ruleset will be used for linting
return;

const orig = require('../resources/standard.config.json');
const styles = require('./style.json')
const func = require('./functional.json')


let newStyles={};
let newFunc={};

for (let rule of Object.keys(orig.rules)){
	if (styles.indexOf(rule)!=-1){
		newStyles[rule] = orig.rules[rule];
	} else if(func.indexOf(rule) != -1){
		newFunc[rule] = orig.rules[rule];
	}else{
		console.log('Missed '+rule)
	}
}
const fs = require('fs');

fs.writeFileSync('../resources/os-style-only-rules.json', JSON.stringify(newStyles, null, 2), 'utf8');
fs.writeFileSync('../resources/os-functional-only-rules.json', JSON.stringify(newFunc, null, 2), 'utf8');
// fs.writeFileSync('../resources/os-style-only-rules.json',newStyles);
//fs.writeFileSync('../resources/os-functional-only-rules.json',newFunc);
// console.log(newStyles)
