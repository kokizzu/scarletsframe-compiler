module.exports = function(pack){
let { obj, gulp, SFLang, firstCompile } = pack;
let { startupCompile, path, includeSourceMap, hotSourceMapContent, hotReload } = obj;
let Obj = obj;

let { collectSourcePath, swallowError, versioning, removeOldMap, sourceMapBase64, watchPath, preprocessPath, indexAutoLoad } = require('./_utils.js');
var sourcemaps = require('gulp-sourcemaps');
var concat = require('gulp-concat');
var header = require('gulp-header');
var fs = require('fs');
var chalk = require('chalk');
const { SourceMapGenerator } = require('source-map');
const JSWrapper = require('../src/js-wrapper.js');
var getRelativePathFromList = require('../sf-relative-path.js');
var terser = null;
var babel = null;

var through = require('through2');
function mergeWrapper(wrapper){
	return through.obj(function(file, encoding, callback){
		file.contents = Buffer.concat([
			Buffer.from(wrapper[0]),
			file.contents,
			Buffer.from(wrapper[1])
		]);

		callback(null, file);
	});
}

var taskList = {};
function addTask(name, obj){
	var last = 0;
	name = 'js-'+name;

	var folderLastPath = obj.js.folder.slice(-1);
	if(folderLastPath !== '/' && folderLastPath !== '\\')
		obj.js.folder += '/';

	if(obj.js.combine)
		gulp.task(name, jsTask(obj));
	else if(obj.js.module)
		gulp.task(name, jsTaskModule(obj));
	else
		console.error(".js settings only support 'combine' or 'module'");

	if(obj.autoGenerate)
		indexAutoLoad(obj, 'js', 'JS');

	var call = gulp.series(name);
	if(Obj._compiling === false){
		var rootPath = obj.js.combine || obj.js.module.from;
		if(obj.js.module !== void 0){
			rootPath = rootPath.split('\\').join('/').split('/');
			rootPath.pop();
			rootPath = rootPath.join('/') + '/**/*.js';
		}

		function onChange(file, stats){
			if(!stats) return call();
			if(last === stats.ctimeMs)
				return;

			last = stats.ctimeMs;
			if(SFLang.scan(file, stats))
				return;

			if(Obj._browserSync && hotReload.js === true){
				let relativePath = getRelativePathFromList(file, rootPath, obj.js.root);
				var changed = fs.readFileSync(file, {encoding:'utf8', flag:'r'});

				// Generate sourcemap
				var map = new SourceMapGenerator({
					file: `unknown.file`
				});

				if(hotSourceMapContent)
					map.setSourceContent(relativePath, changed);

				let lines = changed.split('\n').length;
				for (let a = 1; a <= lines; a++) {
					map.addMapping({
						original: {line: a, column: 0},
						generated: {line: a+2, column: 0},
						source: relativePath,
					});
				}

				changed += sourceMapBase64(map.toString());

				Obj._browserSync.sockets.emit('sf-hot-js', changed);
				Obj._browserSync.notify("JavaScript Reloaded");
			}

			call();
		}

		taskList[obj.js.file] = gulp.watch(rootPath)
			.on('add', onChange)
			.on('change', onChange)
			.on('unlink', onChange)
			.on('error', console.error);

		var isExist = obj.js;
		isExist = fs.existsSync(isExist.folder+isExist.file);

		if(!isExist){
			console.log(`[First-Time] Compiling JavaScript for '${chalk.cyan(name)}'...`);
			call();
		}
		else if(startupCompile)
			setTimeout(call, 500);
	}

	else call();
}

function jsTask(path){
	return function(){
		obj.onCompiled && firstCompile.js++;

		var startTime = Date.now();
		removeOldMap(path.js.folder, path.js.file.replace('.js', ''), '.js');
		var temp = gulp.src(path.js.combine, path.js.opt);

		if(includeSourceMap)
			temp = temp.pipe(sourcemaps.init());

		temp = temp.pipe(concat(path.js.file)).pipe(SFLang.jsPipe());

		if(path.js.wrapped !== void 0){
			if(path.js.wrapped === true)
				temp = temp.pipe(mergeWrapper(JSWrapper.true));
			else if(path.js.wrapped === 'async')
				temp = temp.pipe(mergeWrapper(JSWrapper.async));
		}

		if(Obj._compiling){
			if(!terser) terser = require('gulp-terser');
			if(!babel) babel = require('gulp-babel');

			temp = temp.pipe(babel()).on('error', swallowError).pipe(terser()).on('error', swallowError);
		}

		if(path.js.header)
			temp = temp.pipe(header(path.js.header+"\n"));

		if(includeSourceMap)
			temp = temp.pipe(sourcemaps.write('.'));

		temp = temp.pipe(gulp.dest(path.js.folder)).on('end', function(){
				if(obj.onCompiled && --firstCompile.js === 0)
					obj.onCompiled('JavaScript');

				if(Obj._browserSync && hotReload.js === void 0)
					Obj._browserSync.reload(path.js.folder+path.js.file);
			});

		versioning(path.versioning, path.js.folder.replace(path.stripURL || '#$%!.', '')+path.js.file+'?', startTime);
		return temp;
	}
}

var jsModule = {};
function jsTaskModule(path){
	return function(){
		obj.onCompiled && firstCompile.js++;

		var startTime = Date.now();
		removeOldMap(path.js.folder, path.js.file.replace('.js', ''), '.js');

		var temp, jm;
		temp = gulp.src(path.js.combine || path.js.module.from, path.js.opt);

		if(path.js.module){
			jm = jsModule;

			if(!jm.rollup)
				jm.rollup = require('gulp-better-rollup');
			if(!jm.commonjs)
				jm.commonjs = require('@rollup/plugin-commonjs');
			if(!jm.resolve)
				jm.resolve = require('@rollup/plugin-node-resolve');

			var plugins = [jm.commonjs(), jm.resolve.nodeResolve()];
			if(Obj._compiling){
				if(!jm.babel)
					jm.babel = require('@rollup/plugin-babel');
				plugins.shift(jm.babel());
			}

			temp = temp.pipe(jm.rollup({
		    	plugins: plugins
		    }, {
		    	format: path.js.module.format || 'cjs'
		    }));
		}

		if(includeSourceMap)
			temp = temp.pipe(sourcemaps.init());

		temp = temp.pipe(concat(path.js.file)).pipe(SFLang.jsPipe());

		if(path.js.wrapped !== void 0){
			if(path.js.wrapped === true)
				temp = temp.pipe(mergeWrapper(JSWrapper.true));
			else if(path.js.wrapped === 'async')
				temp = temp.pipe(mergeWrapper(JSWrapper.async));
		}

		if(!jm && Obj._compiling){
			if(!terser) terser = require('gulp-terser');

			temp = temp.pipe(terser()).on('error', swallowError);
		}

		if(path.js.header)
			temp = temp.pipe(header(path.js.header+"\n"));

		if(includeSourceMap)
			temp = temp.pipe(sourcemaps.mapSources(function(sourcePath, file) {
		        return path.js.folder + sourcePath;
		    })).pipe(sourcemaps.write('.'))

		temp = temp.pipe(gulp.dest(path.js.folder)).on('end', function(){
				if(obj.onCompiled && --firstCompile.js === 0)
					obj.onCompiled('JavaScript');

				if(Obj._browserSync && hotReload.js === void 0)
					Obj._browserSync.reload(path.js.folder+path.js.file);
			});

		versioning(path.versioning, path.js.folder.replace(path.stripURL || '#$%!.', '')+path.js.file+'?', startTime);
		return temp;
	}
}

function removeTask(obj){
	preprocessPath('unknown', obj, 'js');
	taskList[obj.js.file].close();

	if(obj.autoGenerate){
		if(!obj.versioning)
			throw ".autoGenerate property was found, but .versioning was not found";

		let temp = obj.autoGenerate.split('**')[0]+obj.js.file+'?';
		let data = fs.readFileSync(obj.versioning, 'utf8');

		data = data.split(temp);
		data[1] = data[1].replace(/^.*?\n[\t\r ]+/s, '');

		fs.writeFileSync(obj.versioning, data.join(''), 'utf8');
	}
}

return { addTask, removeTask };
}