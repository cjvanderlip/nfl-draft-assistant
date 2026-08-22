---
description: Audit code for security vulnerabilities and best practices
agent: security-engineer
argument-hint: Directory or file path to audit (e.g., src/)
---

# Security Audit

Request a security analysis of specific files or directories.

The security engineer will check for:

1. **Input Validation** - injection vulnerabilities, sanitization
2. **Authentication & Authorization** - access controls
3. **Dependency Security** - vulnerable packages
4. **Error Handling** - information leakage, secure error messages
5. **Data Protection** - encryption, secrets management
6. **Configuration** - hardcoded values, environment variables

## Input

Specify which files or directories to audit:
- Source directory: `src/`
- Specific file: `src/auth/login.ts`
- Multiple areas: `src/models/ src/services/`

## Output

- Vulnerabilities identified by severity (Critical, High, Medium, Low)
- Specific code locations and examples
- Remediation guidance for each issue
- References to security standards (OWASP)
- Summary of security posture
