/// This script is a simple helper to create two esLint configurations for us.  One will be stylistic only, the other will combine style and function rules
/// the stylistic only will be used for formatting within the plugin
/// The combined ruleset will be used for linting.

// Base Configuration used for both config files
const baseConfig = require('./os-eslint-config-base.json');
// Style-only ruleset
const style = require('./os-style-only-rules.json');
const functional = require('./os-functional-only-rules.json');

// Set of globals to place into both configs
const zenGlobals = require('./os-zenIncludes.json')

// Style is a subset of the overall config, so build everything into style first
let styleObj = JSON.parse(JSON.stringify(baseConfig));
styleObj.rules = style
// Add all of the globals for the zen+os frameworks
for (let global of Object.keys(zenGlobals)){
	styleObj.globals[global] = zenGlobals[global];
}

let functionalObj = JSON.parse(JSON.stringify(styleObj));

for (let rule of Object.keys(functional)){
	functionalObj.rules[rule]=functional[rule];
}
const file = require('fs');
file.writeFileSync('../os-eslint-style-config.json', JSON.stringify(styleObj, null, 2), 'utf8');
file.writeFileSync('../os-eslint-combined-config.json', JSON.stringify(functionalObj, null, 2), 'utf8');