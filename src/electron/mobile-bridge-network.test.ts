import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isPrivateLanAddress } from './mobile-bridge-network';

describe('mobile bridge private LAN detection', () => {
  it('allows RFC1918 and link-local IPv4 addresses', () => {
    assert.equal(isPrivateLanAddress('10.0.0.8'), true);
    assert.equal(isPrivateLanAddress('172.16.4.2'), true);
    assert.equal(isPrivateLanAddress('172.31.255.2'), true);
    assert.equal(isPrivateLanAddress('192.168.1.20'), true);
    assert.equal(isPrivateLanAddress('169.254.3.4'), true);
  });

  it('rejects public, loopback, and malformed IPv4 addresses', () => {
    assert.equal(isPrivateLanAddress('8.8.8.8'), false);
    assert.equal(isPrivateLanAddress('172.32.0.1'), false);
    assert.equal(isPrivateLanAddress('127.0.0.1'), false);
    assert.equal(isPrivateLanAddress('not-an-ip'), false);
  });
});
