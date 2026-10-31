import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { AUTHORITY_SCHEMA_VERSION } from '../authority-store.js';

const SNAPSHOT_FORMAT = 'opengym-authority-snapshot/v1';
const sourceFilename = 'authority.sqlite';
const countedTables = [
  'operational_roles',
  'coordinator_scopes',
  'invitations',
  'invitation_grants',
  'enrollment_sessions',
  'relations',
  'relation_access_windows',
  'relation_grants',
  'relation_pending_grants',
  'subscription_intervals',
  'indefinite_client_entitlements',
  'commercial_operations',
  'goal_versions',
  'plan_versions',
  'client_sessions',
  'session_executions',
  'export_jobs',
  'deletion_requests',
  'authority_audit',
  'aggregate_versions',
  'mutation_results',
  'bodyweight_entries',
  'history_shares',
];
const requiredTables = ['schema_meta', 'authority_meta', ...countedTables];

function opaqueFailure() {
  process.stderr.write('snapshot authority failed\n');
  process.exitCode = 1;
}

function requireRegularDirectory(directory) {
  const details = fs.lstatSync(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('invalid directory');
  return details;
}

function requireRegularFile(file) {
  const details = fs.lstatSync(file);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('invalid file');
}

function optionalRegularFile(file) {
  try {
    requireRegularFile(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) throw new Error('invalid arguments');
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if ((option !== '--source' && option !== '--destination') || !value || values.has(option)) throw new Error('invalid arguments');
    values.set(option, value);
  }
  if (values.size !== 2) throw new Error('invalid arguments');
  return {
    sourceDirectory: path.resolve(values.get('--source')),
    destination: path.resolve(values.get('--destination')),
  };
}

function validateDestination(sourceFile, destination) {
  const destinationDirectory = path.dirname(destination);
  requireRegularDirectory(destinationDirectory);
  if ((fs.statSync(destinationDirectory).mode & 0o077) !== 0) throw new Error('destination directory is not private');
  if (sourceFile === destination) throw new Error('source and destination match');
  try {
    fs.lstatSync(destination);
    throw new Error('destination exists');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function createWorkingDirectory(destinationDirectory) {
  const workingDirectory = fs.mkdtempSync(path.join(destinationDirectory, '.snapshot-authority-'));
  fs.chmodSync(workingDirectory, 0o700);
  requireRegularDirectory(workingDirectory);
  return workingDirectory;
}

function copySourceToWorkingDirectory(sourceFile, workingDirectory) {
  const stagedFile = path.join(workingDirectory, sourceFilename);
  fs.copyFileSync(sourceFile, stagedFile, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(stagedFile, 0o600);

  const sourceWal = `${sourceFile}-wal`;
  if (optionalRegularFile(sourceWal)) {
    const stagedWal = `${stagedFile}-wal`;
    fs.copyFileSync(sourceWal, stagedWal, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(stagedWal, 0o600);
  }
  return stagedFile;
}

function assertNoSidecars(file) {
  for (const sidecar of [`${file}-wal`, `${file}-shm`]) {
    try {
      fs.lstatSync(sidecar);
      throw new Error('snapshot sidecar exists');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function makeStandaloneCandidate(file) {
  const database = new DatabaseSync(file);
  try {
    const journalMode = database.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode;
    if (String(journalMode).toLowerCase() !== 'delete') throw new Error('unable to make standalone snapshot');
  } finally {
    database.close();
  }
  assertNoSidecars(file);
  fs.chmodSync(file, 0o600);
}

function publishExclusively(candidate, destination) {
  fs.linkSync(candidate, destination);
}

function checkedInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validateDatabase(database) {
  const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') throw new Error('integrity failure');
  const availableTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  if (!requiredTables.every(table => availableTables.has(table))) throw new Error('unsupported schema');
  const schema = database.prepare('SELECT version FROM schema_meta WHERE id=1').get();
  const authority = database.prepare('SELECT schema_version, authority_version FROM authority_meta WHERE id=1').get();
  if (!schema || !authority || !checkedInteger(schema.version) || !checkedInteger(authority.schema_version) || !checkedInteger(authority.authority_version)) throw new Error('invalid schema metadata');
  if (schema.version !== AUTHORITY_SCHEMA_VERSION || authority.schema_version !== AUTHORITY_SCHEMA_VERSION) throw new Error('unsupported schema');
  return {
    supported_version: AUTHORITY_SCHEMA_VERSION,
    version: schema.version,
    authority_version: authority.authority_version,
  };
}

function entityCounts(database) {
  return Object.fromEntries(countedTables.map(table => [
    table,
    database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,
  ]));
}

function inspectReadOnly(file) {
  const location = pathToFileURL(file);
  location.searchParams.set('immutable', '1');
  const database = new DatabaseSync(location, { readOnly: true });
  try {
    return { schema: validateDatabase(database), entity_counts: entityCounts(database) };
  } finally {
    database.close();
  }
}

async function run() {
  const { sourceDirectory, destination } = parseArguments(process.argv.slice(2));
  requireRegularDirectory(sourceDirectory);
  const sourceFile = path.join(sourceDirectory, sourceFilename);
  requireRegularFile(sourceFile);
  validateDestination(sourceFile, destination);

  const workingDirectory = createWorkingDirectory(path.dirname(destination));
  try {
    const stagedFile = copySourceToWorkingDirectory(sourceFile, workingDirectory);
    const candidate = path.join(workingDirectory, 'snapshot.sqlite');
    const staged = new DatabaseSync(stagedFile);
    try {
      staged.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      validateDatabase(staged);
      await backup(staged, candidate);
    } finally {
      staged.close();
    }
    makeStandaloneCandidate(candidate);
    const metadata = inspectReadOnly(candidate);
    publishExclusively(candidate, destination);
    process.stdout.write(`${JSON.stringify({ format: SNAPSHOT_FORMAT, ...metadata })}\n`);
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
}

run().catch(opaqueFailure);
