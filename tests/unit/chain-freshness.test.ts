import { assessChain, chainStatusTitle, serverLabel, validateReferenceUrl } from '../../class/xbt/chain-freshness';

const match = (source = 'mempool.guide', height = 977037) => ({
  source,
  height,
  comparisonHeight: 977031,
  matches: true,
});
describe('advisory chain freshness policy', () => {
  it('verifies unchanged heights rather than demanding a new block', () => {
    expect(assessChain(977037, [match()], false).state).toBe('verified');
  });
  it('allows either available reference', () => {
    expect(assessChain(977037, [match('Knots')], false)).toMatchObject({
      state: 'verified',
      source: 'Knots',
    });
    expect(assessChain(977037, [match()], false).state).toBe('verified');
  });
  it('does not call two stale home services verified if the public chain is ahead', () => {
    expect(assessChain(976710, [match('Knots', 976710), match('mempool.guide', 977037)], false).state).toBe('suspect');
    expect(assessChain(976710, [match('Knots', 976710), match('mempool.guide', 977037)], true).state).toBe('behind');
  });
  it('allows propagation lag of up to two blocks', () => {
    expect(assessChain(977035, [match()], false).state).toBe('verified');
  });
  it('requires repetition before confirming a header discrepancy', () => {
    const divergent = { ...match(), matches: false };
    expect(assessChain(977037, [divergent], false).state).toBe('suspect');
    expect(assessChain(977037, [divergent], true).state).toBe('disagreement');
  });
  it('reports unavailability without claiming the home server is behind', () => {
    expect(assessChain(977037, [], false).state).toBe('unverified');
  });
  it('does not call a much older reference fresh evidence', () => {
    expect(assessChain(977037, [match('mempool.guide', 976000)], false).state).toBe('unverified');
  });
  it('names the actual provider implementation', () => {
    expect(serverLabel('Fulcrum 2.1.2')).toBe('Fulcrum');
    expect(serverLabel('Shulcrum 1.0')).toBe('Fulcrum');
    expect(serverLabel('electrs 0.10')).toBe('Electrum');
    expect(serverLabel(false)).toBe('Electrum');
  });
  it('labels home-only verification explicitly', () => {
    expect(
      chainStatusTitle({
        state: 'verified',
        source: 'Knots',
        serverLabel: 'Fulcrum',
        message: '',
        references: [],
      }),
    ).toBe('Matches your Knots');
  });
  it('uses the approved specific warning', () => {
    expect(
      chainStatusTitle({
        state: 'behind',
        serverLabel: 'Fulcrum',
        message: '',
        references: [],
      }),
    ).toBe('Your Fulcrum is behind');
  });
  it.each([
    'http://node.example/chain',
    'https://u:p@node.example/chain',
    'https://node.example/chain?token=x',
    'https://node.example/chain#x',
  ])('rejects unsafe reference URL %s', url => {
    expect(() => validateReferenceUrl(url)).toThrow();
  });
  it('accepts an HTTPS metadata-only endpoint or clearing the endpoint', () => {
    expect(validateReferenceUrl('https://node.example/chain')).toBe('https://node.example/chain');
    expect(validateReferenceUrl('')).toBe('');
  });
});
