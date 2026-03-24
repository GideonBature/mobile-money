apiVersion: v1
kind: Secret
metadata:
  name: mobile-money-secrets
type: Opaque
data:
  DATABASE_URL: cG9zdGdyZXM6Ly91c2VyOnBhc3N3b3JkQHBvc3RncmVzLXNlcnZpY2U6NTQzMi9tb2JpbGVfbW9uZXk=
  # Renamed to match standard code expectations + Valid Seed format
  STELLAR_SECRET_KEY: U0JDSks0WFlLRE9MQU9SRE9MV0U3S05HSlNLU09LSkxTUE9TS0pMU09LSlNQU09MS0pTU09M
  REDIS_URL: cmVkaXM6Ly9yZWRpcy1zZXJ2aWNlOjYzNzk=
  MTN_API_KEY: bXRuLWtleQ==
  MTN_API_SECRET: bXRuLXNlY3JldA==
  MTN_SUBSCRIPTION_KEY: bXRuLXN1Yg==
  AIRTEL_API_KEY: YWlydGVsLWtleQ==
  AIRTEL_API_SECRET: YWlydGVsLXNlY3JldA==
  ORANGE_API_KEY: b3JhbmdlLWtleQ==
  ORANGE_API_SECRET: b3JhbmdlLXNlY3JldA==