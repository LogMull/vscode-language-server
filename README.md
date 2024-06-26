# osc-language-server

This VSCode extension is intended to be used alongside InterSystems Language Server for some additional features when working with Cache Objectscript.  This extension will add linting abilities to the embedded javascript within Cache Objectscript classes.  ESLint does the majority of the heavy lifting for the functionality. The rules for ESLint are not configurable.


Additionally, some basic Cache Objectscript is also linted for styling purposes.

## Functionality
### Linting
* Provide diagnostics for code issues, but functional and style-only
* Provide the ability to fix issues
	* All in the current file
	* All of a certain type in file
	* All in selected range
* OSC Class Header comment validation

### Formatting
* Use ESLint to handle styling javascript code
* Style-only issues can be fixed by formatting the document with this plugin
* XML Formatting from original VM Plugin

### Other
* Goto symbol with offset from original VM Plugin


## Extension contributions
This extension contributes the following

### Settings
* `osc.language-server.requireModifications`: Determines if diagnotics populate automatically or require a change in the file (default)


### Commands
* `osc.language-server.gotosymbol`: Goes to a symbol on the file with offset from start or end of file
* `osc.language-server.fixAll`: Fixes all fixable problems in the current file.  Available in the context menu as well
* `osc.language-server.fixSelection`: Fixes all fixable problems in the current selection.  Available in the context menu as well
* `osc.language-server.fixTypes`: Fixes all fixable problems matching the selected type in the current file.  Available in the context menu as well
* `osc.language-server.toggleAllLint`: Toggles linting. Does not persist when Code is restarted
* `osc.language-server.toggleCurrentLint`: Toggles linting for the current file.  Does not persist when Code is restarted


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
