import test from 'node:test'
import assert from 'node:assert/strict'
import { tiktokUrl, findTikTokLink, isTikTokLink } from '../src/components/guestTikTok.js'
const cases = [["https://www.tiktok.com/@shop",true],["https://vm.tiktok.com/abc/",true],["https://tiktok.com.evil.test/@shop",false],["https://evil.test/tiktok.com",false],["javascript:alert(1)",false],["http://www.tiktok.com/@shop",false],["https://evil.test@www.tiktok.com/@shop",false],["https://www.tiktok.com/",false],["https://www.tiktok.com/\\evil",false],["",false]]
test('accepts HTTPS TikTok links only', () => { for (const [url, valid] of cases) assert.equal(Boolean(tiktokUrl(url)), valid, url) })
test('finds valid published TikTok links and ignores invalid links', () => { const url = 'https://www.tiktok.com/@shop'; assert.equal(findTikTokLink([{label:'TikTok',url:'https://evil.test'}, {label:'TikTok',url}]).url, url); assert.equal(findTikTokLink([]), undefined); assert.equal(isTikTokLink({label:'Other',url:'https://evil.test/tiktok.com'}), false) })
