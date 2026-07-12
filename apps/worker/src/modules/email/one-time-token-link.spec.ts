import {
  createEmailVerificationLink,
  createPasswordResetLink,
  createWorkspaceInvitationLink,
} from './one-time-token-link';

const input = {
  hmacKey: '0123456789abcdef0123456789abcdef',
  tokenId: '00112233-4455-6677-8899-aabbccddeeff',
  webOrigin: 'https://rivet.example.com',
};

describe('one-time token links', () => {
  it('recreates the email verification token in a URL fragment', () => {
    expect(createEmailVerificationLink(input)).toBe(
      'https://rivet.example.com/verify-email#token=ABEiM0RVZneImaq7zN3u_w.b9dkl1NUk0Y-f6CNhCPqmCagDgzHDJYgLe5x7YqNP44',
    );
  });

  it('separates password reset tokens by purpose', () => {
    expect(createPasswordResetLink(input)).toBe(
      'https://rivet.example.com/reset-password#token=ABEiM0RVZneImaq7zN3u_w.POTarJSdC-jv4Zh4vNyGBoCjsyPztrK__Ib02YiC01w',
    );
  });

  it('creates a workspace invitation link without exposing the token in the query', () => {
    const link = createWorkspaceInvitationLink(input);

    expect(link).toMatch(/^https:\/\/rivet\.example\.com\/invite#token=/);
    expect(new URL(link).search).toBe('');
  });

  it('rejects a malformed token ID', () => {
    expect(() => createEmailVerificationLink({ ...input, tokenId: 'not-a-uuid' })).toThrow(
      'tokenId는 UUID여야 합니다.',
    );
  });
});
