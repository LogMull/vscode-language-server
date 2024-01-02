# osc-language-server

This VSCode extension is intended to be used alongside InterSystems Language Server for some additional features when working with Cache Objectscript.  This extension will add linting abilities to the embedded javascript within Cache Objectscript classes.  ESLint does the majority of the heavy lifting for the functionality.

## Functionality
The extension will provide diagnostics as well as auto-fix capabilities for such diagnostics.


Ability to fix all fixable issues in a given class.  This is similar to vscode's autofix command.

## External References
XML Formatting https://www.npmjs.com/package/xml-js, both used as distributed and modified for our specific use case, permitted under the MIT Liscense.
Intersystems Language Server, used for symbol recognition within classes and macros
Intersystems Server Manager, used for authentication to the Version Manager namespace

## Linter Rules
Due to how ESLint is being run in the extension, we jump through several additional hoops to specify our rules for linting.  This is because ESLint looks at paths relative to where nodejs is running, in this case, this in vscode context, so none of our normal relative paths work as expected. In order to get around this, we build and maintain our own config file that can be passed directly into ESLint as a configuration object.  We maintain two version, a style-only configuration, which is used for the plugin's formatting capabiliies, and a 'combined' configuration which consists of both style and functional rules, used for the linting process.


The directory `server/resources/configBuilders/` contains several important things related to this process
* os-eslint-config-base.json - Base configuration shared between configs
* os-zenIncludes.json - Similar to config-base, contains globals that exist in our environment, for example, zenIndex, zenPage, osEvent, etc.
* os-functional-only-rules.json - Functional linting rules that go beyond styling
* os-style-only-rules.json - Style rules only.
* buildConfig.ts -  Used to generate final config files used by the extension.  When any of the above are changed, this should be executed to regenerate the configs.


The linting rules were intiailly based off of StandardJS, but has been modified to closer align with the styling preferences of the development team.
