# Codecov Setup Guide

## Quick Setup (5 minutes)

### Step 1: Sign Up for Codecov
1. Visit https://codecov.io
2. Click "Sign up with GitHub"
3. Authorize Codecov to access your repositories

### Step 2: Add Repository
1. In Codecov dashboard, click "Add new repository"
2. Find and select `sublime247/mobile-money`
3. Copy the upload token shown

### Step 3: Add GitHub Secret
1. Go to https://github.com/sublime247/mobile-money/settings/secrets/actions
2. Click "New repository secret"
3. Name: `CODECOV_TOKEN`
4. Value: [paste the token from Step 2]
5. Click "Add secret"

### Step 4: Verify Setup
1. Push code to main branch or create a PR
2. Go to GitHub Actions tab
3. Wait for CI workflow to complete
4. Check Codecov dashboard for coverage report
5. Verify badge appears in README

## Badge Configuration

### Current Badge
```markdown
[![codecov](https://codecov.io/gh/sublime247/mobile-money/branch/main/graph/badge.svg)](https://codecov.io/gh/sublime247/mobile-money)
```

### Custom Badge Styles
```markdown
<!-- Flat style -->
[![codecov](https://codecov.io/gh/sublime247/mobile-money/branch/main/graph/badge.svg?style=flat)](https://codecov.io/gh/sublime247/mobile-money)

<!-- Flat-square style -->
[![codecov](https://codecov.io/gh/sublime247/mobile-money/branch/main/graph/badge.svg?style=flat-square)](https://codecov.io/gh/sublime247/mobile-money)

<!-- For-the-badge style -->
[![codecov](https://codecov.io/gh/sublime247/mobile-money/branch/main/graph/badge.svg?style=for-the-badge)](https://codecov.io/gh/sublime247/mobile-money)
```

## Coverage Thresholds

### Current Settings
- Minimum coverage: 70%
- Threshold variance: 2%
- Fail CI if coverage drops below threshold

### Adjusting Thresholds
Edit `jest.config.js`:
```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70
  }
}
```

Edit `codecov.yml`:
```yaml
coverage:
  status:
    project:
      default:
        target: 70%
        threshold: 2%
```

## Codecov Features

### Pull Request Comments
Codecov automatically comments on PRs with:
- Coverage percentage change
- Lines covered/uncovered
- File-by-file breakdown
- Visual diff of coverage changes

### Coverage Visualization
- Line-by-line coverage in Codecov UI
- Sunburst chart of project coverage
- Coverage trends over time
- Commit-by-commit tracking

### Notifications
Configure in Codecov settings:
- Slack notifications
- Email alerts
- Webhook integrations

## Troubleshooting

### Badge Shows "unknown"
- Wait 5-10 minutes after first push
- Verify workflow completed successfully
- Check Codecov received the upload
- Clear browser cache

### Coverage Not Uploading
```bash
# Check GitHub Actions logs for errors
# Common issues:
# 1. CODECOV_TOKEN not set
# 2. Coverage file not generated
# 3. Network issues

# Verify locally:
npm run test:coverage
ls -la coverage/lcov.info  # Should exist
```

### Token Issues
- Regenerate token in Codecov settings
- Update GitHub secret with new token
- Re-run failed workflow

### Coverage Seems Wrong
- Check `codecov.yml` ignore patterns
- Verify `jest.config.js` collectCoverageFrom
- Ensure tests are actually running

## Local Development

### Generate Coverage Report
```bash
npm run test:coverage
```

### View HTML Report
```bash
# Linux
xdg-open coverage/lcov-report/index.html

# macOS
open coverage/lcov-report/index.html

# Windows
start coverage/lcov-report/index.html
```

### Check Coverage Thresholds
```bash
# Will fail if below 70%
npm run test:coverage
```

## Alternative: Coveralls

If you prefer Coveralls over Codecov:

### 1. Sign up at https://coveralls.io
### 2. Add repository
### 3. Update workflow:
```yaml
- name: Upload to Coveralls
  uses: coverallsapp/github-action@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 4. Update badge:
```markdown
[![Coverage Status](https://coveralls.io/repos/github/sublime247/mobile-money/badge.svg?branch=main)](https://coveralls.io/github/sublime247/mobile-money?branch=main)
```

## Next Steps
1. Complete Codecov setup (Steps 1-4 above)
2. Write tests for existing code
3. Monitor coverage in PRs
4. Aim to increase coverage over time
5. Review uncovered code regularly
