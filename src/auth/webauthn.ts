import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
} from "@simplewebauthn/server";
import { pool } from "../config/database";
import { redisClient } from "../config/redis";
import { encrypt, decrypt } from "../utils/encryption";

// ─── Configuration ────────────────────────────────────────────────────────────

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

function getRpConfig(): { rp