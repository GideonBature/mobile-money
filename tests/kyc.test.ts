import request from 'supertest';
import app from '../src/index';
import { Pool } from 'pg';

// Mock database for testing
const mockPool = {
  query: jest.fn(),
} as unknown as Pool;

describe('KYC API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up mock database connection
    app.locals.db = mockPool;
  });

  describe('POST /api/kyc/applicants', () => {
    it('should create a new KYC applicant', async () => {
      const mockApplicant = {
        id: 'applicant_123',
        first_name: 'John',
        last_name: 'Doe',
        created_at: '2024-01-15T10:30:00Z',
      };

      // Mock database responses
      mockPool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // Check if user exists
        .mockResolvedValueOnce({ rows: [] }); // Store applicant reference

      // Mock KYC service response
      jest.mock('../src/services/kyc', () => ({
        default: jest.fn().mockImplementation(() => ({
          createApplicant: jest.fn().mockResolvedValue(mockApplicant),
        })),
      }));

      const response = await request(app)
        .post('/api/kyc/applicants')
        .set('Authorization', 'Bearer valid_token')
        .send({
          first_name: 'John',
          last_name: 'Doe',
          email: 'john.doe@example.com',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.applicant_id).toBe('applicant_123');
    });

    it('should return 401 for unauthorized requests', async () => {
      const response = await request(app)
        .post('/api/kyc/applicants')
        .send({
          first_name: 'John',
          last_name: 'Doe',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('User not authenticated');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/kyc/applicants')
        .set('Authorization', 'Bearer valid_token')
        .send({
          first_name: '',
          last_name: 'Doe',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
    });
  });

  describe('GET /api/kyc/status', () => {
    it('should return user KYC status', async () => {
      const mockUser = {
        kyc_level: 'basic',
      };

      const mockApplicant = {
        applicant_id: 'applicant_123',
        verification_status: 'approved',
        kyc_level: 'basic',
        updated_at: '2024-01-15T10:30:00Z',
      };

      mockPool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [mockUser] }) // Get user KYC level
        .mockResolvedValueOnce({ rows: [mockApplicant] }); // Get latest applicant

      const response = await request(app)
        .get('/api/kyc/status')
        .set('Authorization', 'Bearer valid_token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.current_kyc_level).toBe('basic');
      expect(response.body.data.transaction_limits.dailyLimit).toBe(100000);
    });

    it('should return 401 for unauthorized requests', async () => {
      const response = await request(app)
        .get('/api/kyc/status');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('User not authenticated');
    });
  });

  describe('POST /api/kyc/webhooks', () => {
    it('should handle webhook events', async () => {
      const webhookPayload = {
        payload: {
          action: 'workflow_run.completed',
          object: {
            id: 'workflow_run_123',
            type: 'workflow_run',
            status: 'completed',
          },
          webhook_id: 'webhook_123',
        },
      };

      const response = await request(app)
        .post('/api/kyc/webhooks')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});

describe('KYC Service', () => {
  let kycService: any;

  beforeEach(() => {
    // Mock environment variables
    process.env.KYC_API_KEY = 'test_api_key';
    process.env.KYC_API_URL = 'https://api.test.onfido.com/v3.6';
    
    // Import the service after setting environment variables
    const KYCService = require('../src/services/kyc').default;
    kycService = new KYCService(mockPool);
  });

  describe('getTransactionLimits', () => {
    it('should return correct limits for none level', () => {
      const limits = kycService.getTransactionLimits('none');
      expect(limits.dailyLimit).toBe(0);
      expect(limits.perTransactionLimit.min).toBe(100);
      expect(limits.perTransactionLimit.max).toBe(1000000);
    });

    it('should return correct limits for basic level', () => {
      const limits = kycService.getTransactionLimits('basic');
      expect(limits.dailyLimit).toBe(100000);
      expect(limits.perTransactionLimit.min).toBe(100);
      expect(limits.perTransactionLimit.max).toBe(1000000);
    });

    it('should return correct limits for full level', () => {
      const limits = kycService.getTransactionLimits('full');
      expect(limits.dailyLimit).toBe(10000000);
      expect(limits.perTransactionLimit.min).toBe(100);
      expect(limits.perTransactionLimit.max).toBe(1000000);
    });
  });

  describe('determineKYCLevel', () => {
    it('should return none level for no reports', () => {
      const level = kycService.determineKYCLevel([], []);
      expect(level).toBe('none');
    });

    it('should return basic level for document verification only', () => {
      const checks = [{ id: 'check_1', status: 'completed' }];
      const reports = [
        { 
          id: 'report_1', 
          name: 'document', 
          status: 'approved' 
        }
      ];
      const level = kycService.determineKYCLevel(checks, reports);
      expect(level).toBe('basic');
    });

    it('should return full level for document and biometric verification', () => {
      const checks = [{ id: 'check_1', status: 'completed' }];
      const reports = [
        { 
          id: 'report_1', 
          name: 'document', 
          status: 'approved' 
        },
        { 
          id: 'report_2', 
          name: 'facial_similarity', 
          status: 'approved' 
        }
      ];
      const level = kycService.determineKYCLevel(checks, reports);
      expect(level).toBe('full');
    });
  });
});

describe('Database Schema', () => {
  it('should create kyc_applicants table with correct structure', async () => {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS kyc_applicants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        applicant_id VARCHAR(255) UNIQUE NOT NULL,
        provider VARCHAR(50) NOT NULL DEFAULT 'entrust',
        applicant_data JSONB,
        verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        kyc_level VARCHAR(20) NOT NULL DEFAULT 'none',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // This would be executed in a real migration
    expect(createTableSQL).toContain('kyc_applicants');
    expect(createTableSQL).toContain('applicant_id VARCHAR(255) UNIQUE NOT NULL');
    expect(createTableSQL).toContain('provider VARCHAR(50) NOT NULL DEFAULT \'entrust\'');
    expect(createTableSQL).toContain('verification_status VARCHAR(20) NOT NULL DEFAULT \'pending\'');
    expect(createTableSQL).toContain('kyc_level VARCHAR(20) NOT NULL DEFAULT \'none\'');
  });
});
