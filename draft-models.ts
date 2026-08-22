import { randomUUID } from 'node:crypto';

import {
  assertIsoDate,
  assertNonEmptyString,
  assertNumberInRange,
  assertObject,
  assertPosition,
  assertRosterSettings,
  assertScoringFormat,
  assertStrategyProfile,
  type Position,
  type ScoringFormat,
  type StrategyProfile,
} from './validators.js';

export type DraftStatus = 'PRE_DRAFT' | 'LIVE' | 'COMPLETE';

export interface RosterSettings {
  starters: Record<string, number>;
  bench: number;
  maxPerPosition?: Record<string, number>;
}

export interface ManagerTendencyProfile {
  managerId: string;
  positionBias: Partial<Record<Position, { avgRound: number; avgReach: number; pickRate: number }>>;
  positionalRunPatterns: Array<{ pattern: string; frequency: number; sampleYears: number }>;
  averageReach: number;
  confidence: number;
  lastComputedAt: string;
}

function validateRosterSettings(value: RosterSettings): void {
  assertRosterSettings(value, 'rosterSettings');

  for (const [position, count] of Object.entries(value.starters)) {
    if (typeof position !== 'string' || position.trim().length === 0) {
      throw new TypeError('rosterSettings.starters keys must be non-empty position names.');
    }
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new TypeError(`rosterSettings.starters.${position} must be a non-negative integer.`);
    }
  }

  if (value.maxPerPosition !== undefined) {
    for (const [position, count] of Object.entries(value.maxPerPosition)) {
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        throw new TypeError(`rosterSettings.maxPerPosition.${position} must be a non-negative integer.`);
      }
    }
  }
}

function validateTendencyProfile(value: ManagerTendencyProfile): void {
  assertObject(value, 'tendencyProfile');
  assertNonEmptyString(value.managerId, 'tendencyProfile.managerId');
  assertIsoDate(value.lastComputedAt, 'tendencyProfile.lastComputedAt');

  if (typeof value.averageReach !== 'number' || Number.isNaN(value.averageReach) || value.averageReach < 0) {
    throw new TypeError('tendencyProfile.averageReach must be a non-negative number.');
  }

  if (typeof value.confidence !== 'number' || Number.isNaN(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new TypeError('tendencyProfile.confidence must be a number between 0 and 1.');
  }

  if (!Array.isArray(value.positionalRunPatterns)) {
    throw new TypeError('tendencyProfile.positionalRunPatterns must be an array.');
  }

  for (const pattern of value.positionalRunPatterns) {
    assertObject(pattern, 'tendencyProfile.positionalRunPatterns[]');
    assertNonEmptyString(pattern.pattern, 'tendencyProfile.positionalRunPatterns[].pattern');
    if (typeof pattern.frequency !== 'number' || Number.isNaN(pattern.frequency) || pattern.frequency < 0 || pattern.frequency > 1) {
      throw new TypeError('tendencyProfile.positionalRunPatterns[].frequency must be between 0 and 1.');
    }
    if (typeof pattern.sampleYears !== 'number' || !Number.isInteger(pattern.sampleYears) || pattern.sampleYears < 1) {
      throw new TypeError('tendencyProfile.positionalRunPatterns[].sampleYears must be a positive integer.');
    }
  }
}

/**
 * Represents a fantasy league and its roster configuration.
 */
export class League {
  readonly id: string;
  readonly createdAt: string;
  private _providerLeagueId: string;
  private _name: string;
  private _scoringFormat: ScoringFormat;
  private _rosterSettings: RosterSettings;
  private _timezone: string;
  private _updatedAt: string;

  constructor({
    id,
    providerLeagueId,
    name,
    scoringFormat,
    rosterSettings,
    timezone,
    createdAt = new Date().toISOString(),
  }: {
    id?: string;
    providerLeagueId: string;
    name: string;
    scoringFormat: ScoringFormat;
    rosterSettings: RosterSettings;
    timezone: string;
    createdAt?: string;
  }) {
    assertNonEmptyString(providerLeagueId, 'providerLeagueId');
    assertNonEmptyString(name, 'name');
    assertScoringFormat(scoringFormat, 'scoringFormat');
    validateRosterSettings(rosterSettings);
    assertNonEmptyString(timezone, 'timezone');
    assertIsoDate(createdAt, 'createdAt');

    this.id = id ?? randomUUID();
    this.createdAt = createdAt;
    this._providerLeagueId = providerLeagueId.trim();
    this._name = name.trim();
    this._scoringFormat = scoringFormat;
    this._rosterSettings = { ...rosterSettings, starters: { ...rosterSettings.starters } };
    this._timezone = timezone.trim();
    this._updatedAt = createdAt;
  }

  get providerLeagueId(): string {
    return this._providerLeagueId;
  }

  set providerLeagueId(value: string) {
    assertNonEmptyString(value, 'providerLeagueId');
    this._providerLeagueId = value.trim();
    this._updatedAt = new Date().toISOString();
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    assertNonEmptyString(value, 'name');
    this._name = value.trim();
    this._updatedAt = new Date().toISOString();
  }

  get scoringFormat(): ScoringFormat {
    return this._scoringFormat;
  }

  set scoringFormat(value: ScoringFormat) {
    assertScoringFormat(value, 'scoringFormat');
    this._scoringFormat = value;
    this._updatedAt = new Date().toISOString();
  }

  get rosterSettings(): RosterSettings {
    return { ...this._rosterSettings, starters: { ...this._rosterSettings.starters } };
  }

  set rosterSettings(value: RosterSettings) {
    validateRosterSettings(value);
    this._rosterSettings = {
      ...value,
      starters: { ...value.starters },
    };
    this._updatedAt = new Date().toISOString();
  }

  get timezone(): string {
    return this._timezone;
  }

  set timezone(value: string) {
    assertNonEmptyString(value, 'timezone');
    this._timezone = value.trim();
    this._updatedAt = new Date().toISOString();
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      providerLeagueId: this._providerLeagueId,
      name: this._name,
      scoringFormat: this._scoringFormat,
      rosterSettings: this.rosterSettings,
      timezone: this._timezone,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }
}

/**
 * Represents a manager within a league.
 */
export class Manager {
  readonly id: string;
  readonly createdAt: string;
  private _leagueId: string;
  private _displayName: string;
  private _tendencyProfile: ManagerTendencyProfile | null;
  private _updatedAt: string;

  constructor({
    id,
    leagueId,
    displayName,
    tendencyProfile,
    createdAt = new Date().toISOString(),
  }: {
    id?: string;
    leagueId: string;
    displayName: string;
    tendencyProfile?: ManagerTendencyProfile | null;
    createdAt?: string;
  }) {
    assertNonEmptyString(leagueId, 'leagueId');
    assertNonEmptyString(displayName, 'displayName');
    assertIsoDate(createdAt, 'createdAt');

    if (tendencyProfile !== undefined && tendencyProfile !== null) {
      validateTendencyProfile(tendencyProfile);
    }

    this.id = id ?? randomUUID();
    this.createdAt = createdAt;
    this._leagueId = leagueId.trim();
    this._displayName = displayName.trim();
    this._tendencyProfile = tendencyProfile ?? null;
    this._updatedAt = createdAt;
  }

  get leagueId(): string {
    return this._leagueId;
  }

  set leagueId(value: string) {
    assertNonEmptyString(value, 'leagueId');
    this._leagueId = value.trim();
    this._updatedAt = new Date().toISOString();
  }

  get displayName(): string {
    return this._displayName;
  }

  set displayName(value: string) {
    assertNonEmptyString(value, 'displayName');
    this._displayName = value.trim();
    this._updatedAt = new Date().toISOString();
  }

  get tendencyProfile(): ManagerTendencyProfile | null {
    return this._tendencyProfile ? { ...this._tendencyProfile } : null;
  }

  set tendencyProfile(value: ManagerTendencyProfile | null) {
    if (value !== null) {
      validateTendencyProfile(value);
    }
    this._tendencyProfile = value ? { ...value } : null;
    this._updatedAt = new Date().toISOString();
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      leagueId: this._leagueId,
      displayName: this._displayName,
      tendencyProfile: this._tendencyProfile,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }
}

/**
 * Represents a player that can appear in the draft pool.
 */
export class Player {
  readonly id: string;
  readonly createdAt: string;
  private _externalIds: { cbs?: string; sleeper?: string; underdog?: string };
  private _fullName: string;
  private _position: Position;
  private _team: string;
  private _byeWeek?: number;
  private _metadata: Record<string, unknown>;
  private _updatedAt: string;

  constructor({
    id,
    externalIds,
    fullName,
    position,
    team,
    byeWeek,
    metadata = {},
    createdAt = new Date().toISOString(),
  }: {
    id?: string;
    externalIds?: { cbs?: string; sleeper?: string; underdog?: string };
    fullName: string;
    position: Position;
    team: string;
    byeWeek?: number;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }) {
    assertNonEmptyString(fullName, 'fullName');
    assertPosition(position, 'position');
    assertNonEmptyString(team, 'team');
    if (byeWeek !== undefined) {
      assertNumberInRange(byeWeek, 'byeWeek', 1, 18);
    }
    assertObject(metadata, 'metadata');
    assertIsoDate(createdAt, 'createdAt');

    this.id = id ?? randomUUID();
    this.createdAt = createdAt;
    this._externalIds = { ...externalIds };
    this._fullName = fullName.trim();
    this._position = position;
    this._team = team.trim();
    this._byeWeek = byeWeek;
    this._metadata = { ...metadata };
    this._updatedAt = createdAt;
  }

  get externalIds(): { cbs?: string; sleeper?: string; underdog?: string } {
    return { ...this._externalIds };
  }

  set externalIds(value: { cbs?: string; sleeper?: string; underdog?: string }) {
    assertObject(value, 'externalIds');
    for (const [provider, id] of Object.entries(value)) {
      if (id !== undefined && (typeof id !== 'string' || id.trim().length === 0)) {
        throw new TypeError(`externalIds.${provider} must be a non-empty string when provided.`);
      }
    }
    this._externalIds = { ...value };
    this._updatedAt = new Date().toISOString();
  }

  get fullName(): string {
    return this._fullName;
  }

  set fullName(value: string) {
    assertNonEmptyString(value, 'fullName');
    this._fullName = value.trim();
    this._updatedAt = new Date().toISOString();
  }

  get position(): Position {
    return this._position;
  }

  set position(value: Position) {
    assertPosition(value, 'position');
    this._position = value;
    this._updatedAt = new Date().toISOString();
  }

  get team(): string {
    return this._team;
  }

  set team(value: string) {
    assertNonEmptyString(value, 'team');
    this._team = value.trim();
    this._updatedAt = new Date().toISOString();
  }

  get byeWeek(): number | undefined {
    return this._byeWeek;
  }

  set byeWeek(value: number | undefined) {
    if (value !== undefined) {
      assertNumberInRange(value, 'byeWeek', 1, 18);
    }
    this._byeWeek = value;
    this._updatedAt = new Date().toISOString();
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  set metadata(value: Record<string, unknown>) {
    assertObject(value, 'metadata');
    this._metadata = { ...value };
    this._updatedAt = new Date().toISOString();
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      externalIds: this._externalIds,
      fullName: this._fullName,
      position: this._position,
      team: this._team,
      byeWeek: this._byeWeek,
      metadata: this._metadata,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }
}

/**
 * Represents a single pick made during a draft.
 */
export class DraftPick {
  readonly id: string;
  readonly pickedAt: string;
  private _leagueId: string;
  private _season: number;
  private _round: number;
  private _overallPick: number;
  private _managerId: string;
  private _playerId: string;
  private _adpAtPick?: number;
  private _reachDelta?: number;

  constructor({
    id,
    leagueId,
    season,
    round,
    overallPick,
    managerId,
    playerId,
    adpAtPick,
    reachDelta,
    pickedAt = new Date().toISOString(),
  }: {
    id?: string;
    leagueId: string;
    season: number;
    round: number;
    overallPick: number;
    managerId: string;
    playerId: string;
    adpAtPick?: number;
    reachDelta?: number;
    pickedAt?: string;
  }) {
    assertNonEmptyString(leagueId, 'leagueId');
    assertNumberInRange(season, 'season', 2000, 2100);
    assertNumberInRange(round, 'round', 1, 20);
    assertNumberInRange(overallPick, 'overallPick', 1, 600);
    assertNonEmptyString(managerId, 'managerId');
    assertNonEmptyString(playerId, 'playerId');
    if (adpAtPick !== undefined) {
      assertNumberInRange(adpAtPick, 'adpAtPick', 1, 500);
    }
    if (reachDelta !== undefined) {
      assertNumberInRange(reachDelta, 'reachDelta', -200, 200);
    }
    assertIsoDate(pickedAt, 'pickedAt');

    this.id = id ?? randomUUID();
    this.pickedAt = pickedAt;
    this._leagueId = leagueId.trim();
    this._season = season;
    this._round = round;
    this._overallPick = overallPick;
    this._managerId = managerId.trim();
    this._playerId = playerId.trim();
    this._adpAtPick = adpAtPick;
    this._reachDelta = reachDelta;
  }

  get leagueId(): string {
    return this._leagueId;
  }

  get season(): number {
    return this._season;
  }

  get round(): number {
    return this._round;
  }

  get overallPick(): number {
    return this._overallPick;
  }

  get managerId(): string {
    return this._managerId;
  }

  get playerId(): string {
    return this._playerId;
  }

  get adpAtPick(): number | undefined {
    return this._adpAtPick;
  }

  get reachDelta(): number | undefined {
    return this._reachDelta;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      leagueId: this._leagueId,
      season: this._season,
      round: this._round,
      overallPick: this._overallPick,
      managerId: this._managerId,
      playerId: this._playerId,
      adpAtPick: this._adpAtPick,
      reachDelta: this._reachDelta,
      pickedAt: this.pickedAt,
    };
  }
}

/**
 * Represents the live state of a draft in progress.
 */
export class DraftSession {
  readonly id: string;
  readonly createdAt: string;
  private _leagueId: string;
  private _season: number;
  private _status: DraftStatus;
  private _strategyProfile: StrategyProfile;
  private _currentPick?: number;
  private _pollingIntervalSeconds: number;
  private _updatedAt: string;

  constructor({
    id,
    leagueId,
    season,
    status,
    strategyProfile,
    currentPick,
    pollingIntervalSeconds = 15,
    createdAt = new Date().toISOString(),
  }: {
    id?: string;
    leagueId: string;
    season: number;
    status: DraftStatus;
    strategyProfile: StrategyProfile;
    currentPick?: number;
    pollingIntervalSeconds?: number;
    createdAt?: string;
  }) {
    assertNonEmptyString(leagueId, 'leagueId');
    assertNumberInRange(season, 'season', 2000, 2100);
    if (status !== 'PRE_DRAFT' && status !== 'LIVE' && status !== 'COMPLETE') {
      throw new TypeError('status must be PRE_DRAFT, LIVE, or COMPLETE.');
    }
    assertStrategyProfile(strategyProfile, 'strategyProfile');
    if (currentPick !== undefined) {
      assertNumberInRange(currentPick, 'currentPick', 1, 600);
    }
    assertNumberInRange(pollingIntervalSeconds, 'pollingIntervalSeconds', 5, 300);
    assertIsoDate(createdAt, 'createdAt');

    this.id = id ?? randomUUID();
    this.createdAt = createdAt;
    this._leagueId = leagueId.trim();
    this._season = season;
    this._status = status;
    this._strategyProfile = strategyProfile;
    this._currentPick = currentPick;
    this._pollingIntervalSeconds = pollingIntervalSeconds;
    this._updatedAt = createdAt;
  }

  get leagueId(): string {
    return this._leagueId;
  }

  get season(): number {
    return this._season;
  }

  get status(): DraftStatus {
    return this._status;
  }

  set status(value: DraftStatus) {
    if (value !== 'PRE_DRAFT' && value !== 'LIVE' && value !== 'COMPLETE') {
      throw new TypeError('status must be PRE_DRAFT, LIVE, or COMPLETE.');
    }
    this._status = value;
    this._updatedAt = new Date().toISOString();
  }

  get strategyProfile(): StrategyProfile {
    return this._strategyProfile;
  }

  set strategyProfile(value: StrategyProfile) {
    assertStrategyProfile(value, 'strategyProfile');
    this._strategyProfile = value;
    this._updatedAt = new Date().toISOString();
  }

  get currentPick(): number | undefined {
    return this._currentPick;
  }

  set currentPick(value: number | undefined) {
    if (value !== undefined) {
      assertNumberInRange(value, 'currentPick', 1, 600);
    }
    this._currentPick = value;
    this._updatedAt = new Date().toISOString();
  }

  get pollingIntervalSeconds(): number {
    return this._pollingIntervalSeconds;
  }

  set pollingIntervalSeconds(value: number) {
    assertNumberInRange(value, 'pollingIntervalSeconds', 5, 300);
    this._pollingIntervalSeconds = value;
    this._updatedAt = new Date().toISOString();
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      leagueId: this._leagueId,
      season: this._season,
      status: this._status,
      strategyProfile: this._strategyProfile,
      currentPick: this._currentPick,
      pollingIntervalSeconds: this._pollingIntervalSeconds,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }
}
