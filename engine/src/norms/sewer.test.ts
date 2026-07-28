import { describe, expect, it } from 'vitest'
import {
  designFilling,
  kGenMax,
  manholeSpacingM,
  maxFilling,
  maxVelocityMps,
  minGravityDiameterMm,
  minSlopeForDiameter,
  minSewerCrownCoverM,
  minSewerDepthM,
  minSewerInvertDepthFromFrostM,
  minSewerInvertDepthM,
  minVelocityMps,
  sewerBurialDepthConstraints,
  sewerRoughnessN,
  stormInletSpacingM,
} from './sewer'
import { getClause } from '../normregistry'

// Reference values are transcribed by hand from the official PDF
// docs/norms/sn-rk-4-01-03-2013-vodootvedenie.pdf (pages noted per test).

describe('СН РК 4.01-03-2013* verified lookups', () => {
  it('5.9.1: minimum gravity diameters (PDF p.39)', () => {
    expect(minGravityDiameterMm('sewer', 'street').value).toBe(200)
    expect(minGravityDiameterMm('sewer', 'intraquarter').value).toBe(150)
    expect(minGravityDiameterMm('storm', 'street').value).toBe(250)
    expect(minGravityDiameterMm('storm', 'intraquarter').value).toBe(200)
    expect(getClause('sewer.minDiameter')?.clause).toBe('5.9.1')
  })

  it('5.11.1: minimum slopes 150/200 mm, none prescribed above 200 (PDF p.42)', () => {
    expect(minSlopeForDiameter(150)?.value).toBe(0.008)
    expect(minSlopeForDiameter(200)?.value).toBe(0.007)
    expect(minSlopeForDiameter(250)).toBeNull()
  })

  it('Таблица 5.19: minimum self-cleaning velocity and design filling (PDF p.40)', () => {
    expect(minVelocityMps(200).value).toBe(0.7)
    expect(designFilling(200).value).toBe(0.6)
    expect(minVelocityMps(400).value).toBe(0.8)
    expect(minVelocityMps(500).value).toBe(0.9)
    expect(minVelocityMps(800).value).toBe(1.0)
    expect(minVelocityMps(900).value).toBe(1.15)
    expect(minVelocityMps(1200).value).toBe(1.15)
    expect(designFilling(1200).value).toBe(0.8)
    expect(minVelocityMps(1500).value).toBe(1.3)
    expect(minVelocityMps(2000).value).toBe(1.5)
  })

  it('note 3 to table 5.19 applies 0.6 m/s only to a confirmed storm P=0.33 years', () => {
    expect(minVelocityMps(200, 'storm', 0.33).value).toBe(0.6)
    expect(minVelocityMps(200, 'storm', 1).value).toBe(0.7)
    expect(minVelocityMps(200, 'storm').value).toBe(0.7)
  })

  it('5.10.3 / 5.10.7: velocity and filling caps (PDF p.40..41)', () => {
    expect(maxVelocityMps('sewer', 'metal').value).toBe(8)
    expect(maxVelocityMps('sewer', 'nonmetal').value).toBe(4)
    expect(maxVelocityMps('storm', 'metal').value).toBe(10)
    expect(maxVelocityMps('storm', 'nonmetal').value).toBe(7)
    expect(maxFilling('sewer').value).toBe(0.8)
    expect(maxFilling('sewer', true).value).toBe(0.75)
    expect(maxFilling('storm').value).toBe(1)
  })

  it('7.4.1: manhole spacing by diameter (PDF p.50)', () => {
    expect(manholeSpacingM(150).value).toBe(35)
    expect(manholeSpacingM(200).value).toBe(50)
    expect(manholeSpacingM(450).value).toBe(50)
    expect(manholeSpacingM(600).value).toBe(75)
    expect(manholeSpacingM(900).value).toBe(100)
    expect(manholeSpacingM(1400).value).toBe(150)
    expect(manholeSpacingM(2000).value).toBe(200)
    expect(manholeSpacingM(2500).value).toBe(250)
  })

  it('7.6.6: storm inlet spacing by slope and street width (PDF p.54)', () => {
    expect(stormInletSpacingM(0.003, 20).value).toBe(50)
    expect(stormInletSpacingM(0.005, 20).value).toBe(60)
    expect(stormInletSpacingM(0.008, 20).value).toBe(70)
    expect(stormInletSpacingM(0.02, 20).value).toBe(80)
    expect(stormInletSpacingM(0.003, 40).value).toBe(60)
  })

  it('Таблица 5.13: general nonuniformity coefficient (PDF p.34)', () => {
    expect(kGenMax(5).value).toBe(3)
    expect(kGenMax(100).value).toBe(2)
    expect(kGenMax(5000).value).toBe(1.6)
    expect(kGenMax(10000).value).toBe(1.6)
    expect(kGenMax(2).value).toBe(3)
    // interpolation between 100 (2.0) and 300 (1.8)
    expect(kGenMax(200).value).toBe(1.9)
    expect(kGenMax(100, '5pct').value).toBe(1.6)
  })

  it('5.8.1: roughness n1 (PDF p.38)', () => {
    expect(sewerRoughnessN('gravity').value).toBe(0.014)
    expect(sewerRoughnessN('pressure').value).toBe(0.013)
  })

  it('7.2.4: keeps frost-to-invert and cover-to-crown constraints semantically separate (PDF p.49)', () => {
    expect(minSewerInvertDepthFromFrostM(200, 1.8).value).toBe(1.5)
    expect(minSewerInvertDepthFromFrostM(600, 1.8).value).toBe(1.3)
    expect(minSewerCrownCoverM().value).toBe(0.7)

    const shallowSmallPipe = sewerBurialDepthConstraints(200, 0.8)
    expect(shallowSmallPipe.frostInvertDepthM).toBe(0.5)
    expect(shallowSmallPipe.crownCoverInvertDepthM).toBe(0.9)
    expect(shallowSmallPipe.minimumInvertDepthM).toBe(0.9)
    expect(shallowSmallPipe.governingConstraint).toBe('crown-cover')

    const largePipe = sewerBurialDepthConstraints(1200, 1.8)
    expect(largePipe.frostInvertDepthM).toBe(1.3)
    expect(largePipe.crownCoverInvertDepthM).toBe(1.9)
    expect(largePipe.minimumInvertDepthM).toBe(1.9)
    expect(largePipe.governingConstraint).toBe('crown-cover')

    const deepFrost = sewerBurialDepthConstraints(200, 2.5)
    expect(deepFrost.minimumInvertDepthM).toBe(2.2)
    expect(deepFrost.governingConstraint).toBe('frost')
  })

  it('keeps minSewerDepthM as a depth-to-invert compatibility alias', () => {
    expect(minSewerDepthM(200, 0.8).value).toBe(minSewerInvertDepthM(200, 0.8).value)
    expect(minSewerDepthM(200, 0.8).value).toBe(0.9)
  })

  it('rejects non-physical burial inputs instead of producing a profile', () => {
    expect(() => minSewerInvertDepthM(0, 1.8)).toThrow(RangeError)
    expect(() => minSewerInvertDepthM(200, -0.1)).toThrow(RangeError)
    expect(() => minSewerInvertDepthM(Number.NaN, 1.8)).toThrow(RangeError)
  })
})
