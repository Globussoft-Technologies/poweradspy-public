import { SUPPORTED_SCHEMA_MAJOR } from '../constants/sduiVersions';

/**
 * Parses a semver string into { major, minor, patch }.
 */
export function parseVersion(versionStr) {
    if (!versionStr || typeof versionStr !== 'string') return { major: 0, minor: 0, patch: 0 };
    const parts = versionStr.split('.').map(Number);
    return {
        major: parts[0] || 0,
        minor: parts[1] || 0,
        patch: parts[2] || 0,
    };
}

/**
 * Checks if the given schema version is compatible with this frontend.
 * - Major must match exactly (breaking changes).
 * - Minor/patch can be anything (new optional fields are ignored, missing ones use defaults).
 */
export function isSchemaCompatible(schemaVersion) {
    if (!schemaVersion) return true; // No version = legacy backend, assume compatible
    const { major } = parseVersion(schemaVersion);
    return major === SUPPORTED_SCHEMA_MAJOR;
}
