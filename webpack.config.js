const path = require('path');

module.exports = {
	entry: {
		extension: './client/src/extension.ts',
		server: './server/src/server.ts',
	},
	target: 'node',
	output: {
		path: path.resolve(__dirname, 'out'),
		filename: '[name].js',
		libraryTarget: 'commonjs2',
	},
	devtool: 'source-map',
	externals: {
		vscode: 'commonjs vscode',
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: 'ts-loader',
			},
		],
	},
};
