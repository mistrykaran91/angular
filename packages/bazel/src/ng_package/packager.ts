/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import * as fs from 'fs';
import * as path from 'path';
import {globSync} from 'tinyglobby';

import {BazelFileInfo, PackageMetadata} from './api';
import {analyzeFileAndEnsureNoCrossImports} from './cross_entry_points_imports';

/**
 * List of known `package.json` fields which provide information about
 * supported package formats and their associated entry paths.
 */
const knownFormatPackageJsonFormatFields = ['main', 'typings', 'module'] as const;

/** Union type matching known `package.json` format fields. */
type KnownPackageJsonFormatFields = (typeof knownFormatPackageJsonFormatFields)[number];

/**
 * Type describing the conditional exports descriptor for an entry-point.
 * https://nodejs.org/api/packages.html#packages_conditional_exports
 */
type ConditionalExport = {
  types?: string;
  default?: string;
};

/** Type describing a `package.json` the packager deals with. */
type PackageJson = {
  [key in KnownPackageJsonFormatFields]?: string;
} & {
  name: string;
  type?: string;
  sideEffects?: string[] | boolean;
  exports?: Record<string, ConditionalExport>;
};

// Main entry-point.
main(process.argv.slice(2));

function main(args: string[]): void {
  // This utility expects all of its arguments to be specified in a params file generated by
  // bazel (see https://docs.bazel.build/versions/master/skylark/lib/Args.html#use_param_file).
  const paramFilePath = args[0];

  // Bazel params may be surrounded with quotes
  function unquoteParameter(s: string) {
    return s.replace(/^'(.*)'$/, '$1');
  }

  // Parameters are specified in the file one per line.
  const params = fs.readFileSync(paramFilePath, 'utf-8').split('\n').map(unquoteParameter);

  const [
    // Output directory for the npm package.
    outputDirExecPath,

    // The package segment of the ng_package rule's label (e.g. 'package/common').
    owningPackageName,

    // JSON data capturing metadata of the package being built. See `PackageMetadata`.
    metadataArg,

    // Path to the package's README.md.
    readmeMd,

    // Path to the package's LICENSE file.
    licenseFile,

    // List of individual ES2022 modules
    esm2022Arg,

    // List of static files that should be copied into the package.
    staticFilesArg,

    // List of side-effectful entry-points
    sideEffectEntryPointsArg,
  ] = params;

  const esm2022 = JSON.parse(esm2022Arg) as BazelFileInfo[];
  const staticFiles = JSON.parse(staticFilesArg) as BazelFileInfo[];
  const metadata = JSON.parse(metadataArg) as PackageMetadata;
  const sideEffectEntryPoints = JSON.parse(sideEffectEntryPointsArg) as string[];

  if (readmeMd) {
    copyFile(readmeMd, 'README.md');
  }

  if (licenseFile) {
    copyFile(licenseFile, 'LICENSE');
  }

  /**
   * Writes a file with the specified content into the package output.
   * @param outputRelativePath Relative path in the output directory where the
   *   file is written to.
   * @param fileContent Content of the file.
   */
  function writeFile(outputRelativePath: string, fileContent: string | Buffer) {
    const outputPath = path.join(outputDirExecPath, outputRelativePath);

    // Always ensure that the target directory exists.
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    fs.writeFileSync(outputPath, fileContent);
  }

  /**
   * Copies a file into the package output to the specified location.
   * @param inputPath File that should be copied.
   * @param outputRelativePath Relative path in the output directory where the
   *   file is written to.
   */
  function copyFile(inputPath: string, outputRelativePath: string) {
    const fileContent = fs.readFileSync(inputPath, 'utf8');
    writeFile(outputRelativePath, fileContent);
  }

  /**
   * Gets the relative path for the given file within the owning package. This
   * assumes the file is contained in the owning package.
   *
   * e.g. consider the owning package is `packages/core` and the input file
   * is `packages/core/testing/index.d.ts`. This function would return the
   * relative path as followed: `testing/index.d.ts`.
   */
  function getOwningPackageRelativePath(file: BazelFileInfo): string {
    return path.relative(owningPackageName, file.shortPath);
  }

  /**
   * Gets the entry-point sub-path from the package root. e.g. if the package name
   * is `@angular/cdk`, then for `@angular/cdk/a11y` just `a11y` would be returned.
   */
  function getEntryPointSubpath(moduleName: string): string {
    return moduleName.slice(`${metadata.npmPackageName}/`.length);
  }

  /**
   * Gets whether the given module name resolves to a secondary entry-point.
   * e.g. if the package name is `@angular/cdk`, then for `@angular/cdk/a11y`
   * this would return `true`.
   */
  function isSecondaryEntryPoint(moduleName: string): boolean {
    return getEntryPointSubpath(moduleName) !== '';
  }

  const crossEntryPointFailures = esm2022.flatMap((file) =>
    analyzeFileAndEnsureNoCrossImports(file, metadata),
  );

  if (crossEntryPointFailures.length) {
    console.error(crossEntryPointFailures);
    process.exit(1);
  }

  // Copy all FESM files (and their potential shared chunks) into the package output.
  const fesmFiles = globSync('**/*', {cwd: metadata.fesmBundlesOut.path});
  fesmFiles.forEach((f) =>
    copyFile(path.join(metadata.fesmBundlesOut.path, f), path.join('fesm2022', f)),
  );

  // Copy all dts files (and their potential shared chunks) into the package output.
  const dtsFiles = globSync('**/*', {cwd: metadata.dtsBundlesOut.path});
  dtsFiles.forEach((f) =>
    // TODO(devversion): Put all types under `/types/` folder. Breaking change in v20.
    copyFile(path.join(metadata.dtsBundlesOut.path, f), f),
  );

  for (const file of staticFiles) {
    // We copy all files into the package output while preserving the sub-path from
    // the owning package. e.g. `packages/core/package.json` ends up `<pkg-out>/package.json`.
    const outputRelativePath = getOwningPackageRelativePath(file);
    let content = fs.readFileSync(file.path, 'utf8');

    // Check and modify package.json files as necessary for publishing
    if (path.basename(file.path) === 'package.json') {
      const isPrimaryPackageJson = outputRelativePath === 'package.json';
      const packageJson = JSON.parse(content) as PackageJson;
      const packageName = packageJson['name'];

      // Prevent non-primary `package.json` files which would throw-off resolution.
      // Resolution in the package should only be based on the top-level `package.json`.
      if (!isPrimaryPackageJson) {
        throw Error(
          `Found a nested "package.json" file in the package output: ${file.shortPath}.\n` +
            `All information of the package should reside in the primary package file.`,
        );
      }

      // Check if the `name` field of the `package.json` files are matching with
      // name of the NPM package. This is an additional safety check.
      if (packageName !== metadata.npmPackageName) {
        throw Error(
          `Primary "package.json" has mismatching package name. Expected the ` +
            `package to be named "${metadata.npmPackageName}", but is set to: ${packageName}.`,
        );
      }

      let newPackageJson = insertFormatFieldsIntoPackageJson(
        outputRelativePath,
        packageJson,
        false,
      );

      newPackageJson = updatePrimaryPackageJson(newPackageJson);

      // Update the content with the new `package.json` file content.
      content = JSON.stringify(newPackageJson, null, 2);
    }

    writeFile(outputRelativePath, content);
  }

  /**
   * Inserts or edits properties into the package.json file(s) in the package so that
   * they point to all the right generated artifacts.
   *
   * @param packageJsonOutRelativePath Path where the `package.json` is stored in
   *   the package output.
   * @param parsedPackage Parsed package.json content
   * @param isGeneratedPackageJson Whether the passed package.json has been generated.
   */
  function insertFormatFieldsIntoPackageJson(
    packageJsonOutRelativePath: string,
    parsedPackage: Readonly<PackageJson>,
    isGeneratedPackageJson: boolean,
  ): PackageJson {
    const packageJson: PackageJson = {...parsedPackage};
    const packageName = packageJson['name'];
    const entryPointInfo = metadata.entryPoints[packageName];
    const packageJsonContainingDir = path.dirname(packageJsonOutRelativePath);

    // If a package json file has been discovered that does not match any
    // entry-point in the metadata, we report a warning as most likely the target
    // is configured incorrectly (e.g. missing `module_name` attribute).
    if (!entryPointInfo) {
      // Ideally we should throw here, as we got an entry point that doesn't
      // have flat module metadata / bundle index, so it may have been an
      // ng_module that's missing a module_name attribute.
      // However, @angular/compiler can't be an ng_module, as it's the internals
      // of the ngc compiler, yet we want to build an ng_package for it.
      // So ignore package.json files when we are missing data.
      console.error('WARNING: no module metadata for package', packageName);
      console.error('   Not updating the package.json file to point to it');
      console.error(
        '   The ng_module for this package is possibly missing the module_name attribute ',
      );
      return packageJson;
    }

    // If we guessed the index paths for a module, and it contains an explicit `package.json`
    // file that already sets format properties, we skip automatic insertion of format
    // properties but report a warning in case properties have been set by accident.
    if (
      entryPointInfo.guessedPaths &&
      !isGeneratedPackageJson &&
      hasExplicitFormatProperties(packageJson)
    ) {
      console.error('WARNING: `package.json` explicitly sets format properties (like `main`).');
      console.error(
        '    Skipping automatic insertion of format properties as explicit ' +
          'format properties are set.',
      );
      console.error('    Ignore this warning if explicit properties are set intentionally.');
      return packageJson;
    }

    const fesm2022RelativeOutPath = entryPointInfo.fesm2022RelativePath;
    const typingsRelativeOutPath = entryPointInfo.dtsBundleRelativePath;

    packageJson.module = normalizePath(
      path.relative(packageJsonContainingDir, fesm2022RelativeOutPath),
    );
    packageJson.typings = normalizePath(
      path.relative(packageJsonContainingDir, typingsRelativeOutPath),
    );

    return packageJson;
  }

  /**
   * Updates the primary `package.json` file of the NPM package to specify
   * the module conditional exports and the ESM module type.
   */
  function updatePrimaryPackageJson(packageJson: Readonly<PackageJson>): PackageJson {
    if (packageJson.type !== undefined && packageJson.type !== 'module') {
      throw Error(
        'The primary "package.json" file of the package sets the "type" field ' +
          'that is controlled by the packager. Please unset it or set `type` to `module`.',
      );
    }

    const newPackageJson: PackageJson = {...packageJson};

    newPackageJson.type = 'module';

    // The `package.json` file is made publicly accessible for tools that
    // might want to query information from the Angular NPM package.
    insertExportMappingOrError(newPackageJson, './package.json', {default: './package.json'});

    // Capture all entry-points in the `exports` field using the subpath export declarations:
    // https://nodejs.org/api/packages.html#packages_subpath_exports.
    for (const [moduleName, entryPoint] of Object.entries(metadata.entryPoints)) {
      const subpath = isSecondaryEntryPoint(moduleName)
        ? `./${getEntryPointSubpath(moduleName)}`
        : '.';
      const fesm2022OutRelativePath = entryPoint.fesm2022RelativePath;
      const typesOutRelativePath = entryPoint.dtsBundleRelativePath;

      // Insert the export mapping for the entry-point. We set `default` to the FESM 2022
      // output, and also set the `types` condition which will be respected by TS 4.5.
      // https://github.com/microsoft/TypeScript/pull/45884.
      insertExportMappingOrError(newPackageJson, subpath, {
        types: normalizePath(typesOutRelativePath),
        // Note: The default conditions needs to be the last one.
        default: normalizePath(fesm2022OutRelativePath),
      });
    }

    checkPackageJsonSideEffects(packageJson);

    return newPackageJson;
  }

  function checkPackageJsonSideEffects(packageJson: PackageJson): void {
    // Convenience if there are no side effects, and it's explicitly marked.
    // This is okay and we don't ask the developer to drop the explicit field.
    if (packageJson.sideEffects === false && sideEffectEntryPoints.length === 0) {
      return;
    }

    if (packageJson.sideEffects === true) {
      throw Error(
        'Unexpected `sideEffects` field in `package.json`. ' +
          'Side effects should be fine-grained and marked via the Bazel `side_effect_entry_points` option.',
      );
    }

    const sideEffects = packageJson.sideEffects as undefined | false | string[];
    const neededSideEffects = sideEffectEntryPoints.map(
      (entryPointModule) => `./${metadata.entryPoints[entryPointModule].fesm2022RelativePath}`,
    );
    const missingSideEffects = neededSideEffects.filter(
      (p) =>
        // It's missing, if the whole package is marked as having no side effects.
        sideEffects === false ||
        // Alternatively, it's missing if the explicit list doesn't contain the pattern.
        !(sideEffects ?? []).includes(p),
    );

    if (missingSideEffects.length > 0) {
      throw Error(
        'Missing side effects in `package.json` `sideEffects` field. ' +
          'Please add the following side effect file patterns:\n' +
          missingSideEffects.join('\n - '),
      );
    }

    // Find potential side-effects that refer to our FESM bundles, but aren't part
    // of the `ng_package` known entry points.
    const unexpectedExtra =
      sideEffects !== false
        ? (sideEffects ?? []).filter(
            (p) => p.includes('fesm2022') && !neededSideEffects.includes(p),
          )
        : [];
    if (unexpectedExtra.length > 0) {
      throw Error(
        'Unexpected side effects in `package.json` `sideEffects` field that is not known to `ng_package`. ' +
          'Please add the side effect entry point to the Bazel `side_effect_entry_points` option. ' +
          'Unexpected patterns:\n' +
          unexpectedExtra.join('\n - '),
      );
    }
  }

  /**
   * Inserts a subpath export mapping into the specified `package.json` object.
   * @throws An error if the mapping is already defined and would conflict.
   */
  function insertExportMappingOrError(
    packageJson: PackageJson,
    subpath: string,
    mapping: ConditionalExport,
  ) {
    if (packageJson.exports === undefined) {
      packageJson.exports = {};
    }
    if (packageJson.exports[subpath] === undefined) {
      packageJson.exports[subpath] = {};
    }

    const subpathExport = packageJson.exports[subpath];

    // Go through all conditions that should be inserted. If the condition is already
    // manually set of the subpath export, we throw an error. In general, we allow for
    // additional conditions to be set. These will always precede the generated ones.
    for (const conditionName of Object.keys(mapping) as [keyof ConditionalExport]) {
      if (subpathExport[conditionName] !== undefined) {
        throw Error(
          `Found a conflicting export condition for "${subpath}". The "${conditionName}" ` +
            `condition would be overridden by the packager. Please unset it.`,
        );
      }

      // **Note**: The order of the conditions is preserved even though we are setting
      // the conditions once at a time (the latest assignment will be at the end).
      subpathExport[conditionName] = mapping[conditionName];
    }
  }

  /** Whether the package explicitly sets any of the format properties (like `main`). */
  function hasExplicitFormatProperties(parsedPackage: Readonly<PackageJson>): boolean {
    return Object.keys(parsedPackage).some((fieldName: string) =>
      knownFormatPackageJsonFormatFields.includes(fieldName as KnownPackageJsonFormatFields),
    );
  }

  /**
   * Normalizes the specified path by replacing backslash separators with Posix
   * forward slash separators.
   */
  function normalizePath(path: string): string {
    const result = path.replace(/\\/g, '/');
    return result.startsWith('.') ? result : `./${result}`;
  }
}
