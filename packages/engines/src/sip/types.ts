/** Raw match tracking row (averaged or single match). */
export type RawMatchMetrics = {
  minutesPlayed: number;
  ballTouches: number;
  oneTouchPossessions: number;
  multiTouchPossessions: number;
  releaseLacesCount: number;
  releaseInsideFootCount: number;
  releaseOtherFootzoneCount: number;
  leftFootTouchCount: number;
  rightFootTouchCount: number;
  leftFootReleaseCount: number;
  rightFootReleaseCount: number;
  leftFootReceiveCount: number;
  rightFootReceiveCount: number;
  leftFootKickingPowerMph: number;
  rightFootKickingPowerMph: number;
  totalDistanceMiles: number;
  sprintDistanceYards: number;
  firstStepAccelerations: number;
  intenseAccelerations: number;
  kickingPowerMph: number;
  topSpeedMph: number;
  sprints: number;
  intenseTurns: number;
  avgTurnEntrySpeedMph: number;
  avgTurnExitSpeedMph: number;
  leftTurns: number;
  rightTurns: number;
  backTurns: number;
  distanceWithBallYards: number;
  topSpeedWithBallMph: number;
  intenseTurnsWithBall: number;
};

export type DerivedMetrics = {
  turnEfficiency: number;
  turnDiversity: number;
  workloadIndex: number;
  sprintFrequency: number;
  accelerationDensity: number;
  ballActivityRate: number;
  twoFootednessScore: number;
  quickReleaseScore: number;
  technicalCleanlinessScore: number;
  directPlayScore: number;
  flairScore: number;
  leftFootTouchPct: number;
  rightFootTouchPct: number;
};

export type TacticalScores = {
  gegenpressScore: number;
  tikiTakaScore: number;
  counterAttackScore: number;
  totalFootballScore: number;
  highLineScore: number;
  wingerScore: number;
  lowBlockScore: number;
  quickReleaseScore: number;
  ballRetentionScore: number;
  technicalCleanlinessScore: number;
  directPlayScore: number;
  flairScore: number;
  pressResistanceScore: number;
  possessionHubScore: number;
  transitionExplosivenessScore: number;
  isolationThreatScore: number;
  twoFootednessScore: number;
};

export type PositionFitResult = {
  primaryPositionFit: string;
  secondaryPositionFit: string | null;
  hybridFit: string | null;
  confidence: number;
};
