# Code Coverage

## Overview
The project uses Jest for testing and Codecov for coverage tracking and reporting. Coverage badges are automatically updated on every push to main.

## Coverage Requirements

### Minimum Thresholds
- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

These thresholds are enforced in CI/CD pipeline and will fail builds that don't meet requirements.

## Viewing Coverage

### Badge
The README displays the current coverage percentage:

[![codecov](https://codecov.io/gh/sublime247/mobile-money/branch/main/graph/badge.svg)](https://codecov.io/gh/sublime247/mobile-money)

### Codecov Dashboard
Visit: https://codecov.io/gh/sublime247/mobile-money

Features:
- Line-by-line coverage visualization
- Coverage trends over time
- Pull request coverage diff
- File and directory coverage breakdown

### Local Coverage Report
```bash
# Run tests with coverage
npm run test:coverage

# Open HTML report
open coverage/lcov-report/index.html
```

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode
```bash
npm run test:watch
```

### With Coverage
```bash
npm run test:coverage
```

### Specific Test File
```bash
npm test -- referenceGenerator.test.ts
```

## Writing Tests

### Test File Location
- Place tests in `tests/` directory
- Mirror source structure: `src/utils/file.ts` → `tests/utils/file.test.ts`
- Or use `__tests__` directories within source folders

### Test File Naming
- `*.test.ts` - Unit tests
- `*.spec.ts` - Integration tests

### Example Test
```typescript
import { myFunction } from '../../src/utils/myFunction';

describe('myFunction', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should handle errors', () => {
    expect(() => myFunction(null)).toThrow('Error message');
  });
});
```

## Coverage Configuration

### Jest Configuration
Coverage settings in `jest.config.js`:
```javascript
collectCoverageFrom: [
  'src/**/*.ts',
  '!src/**/*.d.ts',
  '!src/index.ts',
  '!src/**/__tests__/**'
],
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70
  }
}
```

### Codecov Configuration
Settings in `codecov.yml`:
- Target coverage: 70%
- Threshold: 2% (allows small decreases)
- Comments on PRs with coverage diff
- Ignores test files and examples

## CI/CD Integration

### Automatic Coverage Upload
On every push and PR:
1. Tests run with coverage collection
2. Coverage report generated (lcov format)
3. Report uploaded to Codecov
4. Badge updated automatically
5. PR comment added with coverage diff

### GitHub Actions Workflow
See `.github/workflows/ci.yml` and `.github/workflows/coverage.yml`

## Setup Instructions

### 1. Sign Up for Codecov
1. Go to https://codecov.io
2. Sign in with GitHub
3. Add repository: sublime247/mobile-money

### 2. Get Codecov Token
1. Go to repository settings on Codecov
2. Copy the upload token
3. Add to GitHub repository secrets as `CODECOV_TOKEN`

### 3. Add GitHub Secret
1. Go to GitHub repository settings
2. Navigate to Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `CODECOV_TOKEN`
5. Value: [paste token from Codecov]

### 4. Verify Setup
1. Push code to main branch
2. Check GitHub Actions tab for workflow run
3. Verify coverage uploaded to Codecov
4. Check badge displays in README

## Coverage Best Practices

### 1. Test Critical Paths
Focus on:
- Business logic
- Data transformations
- Error handling
- Edge cases

### 2. Don't Test Everything
Skip:
- Type definitions
- Simple getters/setters
- Configuration files
- Third-party integrations (mock instead)

### 3. Aim for Meaningful Coverage
- 70% is minimum, not target
- 100% coverage doesn't mean bug-free
- Focus on quality over quantity

### 4. Review Coverage Reports
- Check which lines are uncovered
- Identify untested edge cases
- Look for dead code

## Troubleshooting

### Coverage Not Uploading
- Check `CODECOV_TOKEN` is set in GitHub secrets
- Verify workflow has `secrets.CODECOV_TOKEN` in codecov action
- Check coverage file exists: `./coverage/lcov.info`

### Badge Not Updating
- Wait 5-10 minutes after push
- Clear browser cache
- Check Codecov dashboard for latest data

### Tests Failing in CI
- Ensure all dependencies in package.json
- Check environment variables are set
- Verify database/Redis services are healthy

### Coverage Below Threshold
- Run `npm run test:coverage` locally
- Check coverage report: `coverage/lcov-report/index.html`
- Add tests for uncovered code
- Consider adjusting thresholds if unrealistic

## Monitoring Coverage

### Pull Request Checks
Codecov automatically:
- Comments on PRs with coverage changes
- Shows coverage diff (lines added/removed)
- Fails PR if coverage drops significantly

### Coverage Trends
Monitor in Codecov dashboard:
- Coverage over time
- Per-file coverage
- Commit-by-commit changes
- Branch comparisons

## Excluded from Coverage
- Test files (`*.test.ts`, `*.spec.ts`)
- Example files (`examples/**/*`)
- Type definitions (`*.d.ts`)
- Entry point (`src/index.ts`)
- Build output (`dist/**/*`)

See `codecov.yml` for full exclusion list.
