import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { adminApi, type AdminPlayerRow } from "../../../../api/admin";
import {
  adminScoreboardApi,
  type AdminSbBulkResult,
} from "../../../../api/admin-scoreboard";
import { useDebouncedValue } from "../../../../hooks/useDebouncedValue";
import { usePageTitle } from "../../../../hooks/usePageTitle";
import { useAdminToast } from "../../components/AdminToast";
import type { SbMatchListItem } from "../../../../api/scoreboard";
import {
  formatKickoffWat,
  formatAdminScoreboardError,
  kickoffAtToWatParts,
  sortRosterMatches,
} from "../admin-scoreboard-utils";
import { AdminSbPageHeader } from "../components/AdminSbPageHeader";
import { AdminSbTableShell } from "../components/AdminSbTableShell";
import { CreateCompetitionModal } from "../components/CreateCompetitionModal";
import { FixtureFormModal } from "../components/FixtureFormModal";
import { TeamFormModal } from "../components/TeamFormModal";
import { CsvDropzone } from "../components/CsvDropzone";
import { StatusBadge } from "../components/StatusBadge";
import { SearchSelect } from "../components/SearchSelect";
import { RecordsBulkBar, type BulkAction } from "../components/RecordsBulkBar";
import { confirmBulk, reportBulk, runInBatches, type Noun } from "../bulk-actions";
import {
  competitionSearchText,
  filterIndexed,
  fixtureSearchText,
  indexForSearch,
  keepCompetition,
  keepFixture,
  keepNameQaRow,
  keepPlayer,
  keepTeam,
  nameQaFlagOptionsFor,
  nameQaRowsFor,
  nameQaSearchText,
  normalizeNameKey,
  playerSearchText,
  searchNeedle,
  squadIdOf,
  teamGroupOptionsFor,
  teamSearchText,
} from "../records-filtering";
import {
  EMPTY_SELECTION,
  allVisibleSelected as allOfSelected,
  pruneToVisible,
  selectedInOrder,
  someVisibleSelected,
  toggle as toggleSelection,
  toggleAllVisible,
  type Selection,
} from "../row-selection";
import type { AdminScoreboardOutletContext } from "../AdminScoreboardLayout";
import {
  COMPETITION_STATUSES,
  COMPETITION_TYPES,
  POSITION_TAGS,
  type AdminSbCompetition,
  type AdminSbCompetitionInput,
  type AdminSbPlayerDirectoryRow,
  type AdminSbSquadRowInput,
  type AdminSbTeam,
  type AdminSbTeamMergePlan,
} from "../types";

type Tab = "competitions" | "teams" | "fixtures" | "players" | "nameQa" | "seeders";
type FixtureEditState = {
  match: SbMatchListItem;
  venue: string;
  kickoffDate: string;
  kickoffTime: string;
  roundLabel: string;
};

type CompetitionEditState = {
  competition: AdminSbCompetition;
  draft: AdminSbCompetitionInput;
};

type SquadEditState = {
  row: AdminSbPlayerDirectoryRow;
  squadId: string;
  draft: AdminSbSquadRowInput;
};

type MergePlayersState = {
  source: AdminSbPlayerDirectoryRow;
  targetPlayerId: string;
  removeSource: boolean;
};

type MergeTeamsState = {
  source: AdminSbTeam;
  targetTeamId: string;
};

type MergeTargetOption = {
  playerId: string;
  displayName: string;
  slug: string | null;
  positionPrimary: string | null;
  context: string;
  source: "scoreboard" | "players";
};

const COMPETITION_CSV_TEMPLATE = `name,type,region,status,isFeatured
Lagos Queens Cup,tournament,Nigeria,active,true`;

const TEAM_CSV_TEMPLATE = `name,slug,region,logo
SGFC Athletics,sgfc-athletics,Lagos,https://example.com/sgfc.png
36 Lions FC,36-lions-fc,Lagos,https://example.com/36-lions.png`;

export function AdminScoreboardEntitiesPage() {
  usePageTitle("Admin — Records");
  const toast = useAdminToast();
  const scoreboardContext = useOutletContext<AdminScoreboardOutletContext | undefined>();
  const refreshStats = scoreboardContext?.refreshStats ?? (async () => {});
  const [tab, setTab] = useState<Tab>("competitions");
  const [competitions, setCompetitions] = useState<AdminSbCompetition[]>([]);
  const [teams, setTeams] = useState<AdminSbTeam[]>([]);
  const [fixtures, setFixtures] = useState<SbMatchListItem[]>([]);
  const [fixtureCompId, setFixtureCompId] = useState("");
  const [players, setPlayers] = useState<AdminSbPlayerDirectoryRow[]>([]);
  const [playerTeamOptions, setPlayerTeamOptions] = useState<AdminSbTeam[]>([]);
  const [picker, setPicker] = useState<Array<{ id: string; name: string }>>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [publishedFilter, setPublishedFilter] = useState("");
  const [featuredFilter, setFeaturedFilter] = useState("");
  const [q, setQ] = useState("");
  const [teamQ, setTeamQ] = useState("");
  const [teamCompId, setTeamCompId] = useState("");
  const [teamGroupFilter, setTeamGroupFilter] = useState("");
  const [playerQ, setPlayerQ] = useState("");
  const [fixtureStatusFilter, setFixtureStatusFilter] = useState("");
  const [fixtureQ, setFixtureQ] = useState("");
  const [playerTeamFilter, setPlayerTeamFilter] = useState("");
  const [playerPositionFilter, setPlayerPositionFilter] = useState("");
  const [playerLinkFilter, setPlayerLinkFilter] = useState("");
  const [nameQaFlagFilter, setNameQaFlagFilter] = useState("");
  const [seedCompId, setSeedCompId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [fixtureOpen, setFixtureOpen] = useState(false);
  const [editingFixture, setEditingFixture] = useState<FixtureEditState | null>(null);
  const [editingCompetition, setEditingCompetition] =
    useState<CompetitionEditState | null>(null);
  const [editingSquadRow, setEditingSquadRow] = useState<SquadEditState | null>(null);
  const [mergingPlayers, setMergingPlayers] = useState<MergePlayersState | null>(null);
  const [mergeTargetQ, setMergeTargetQ] = useState("");
  const [mergeMasterTargets, setMergeMasterTargets] = useState<AdminPlayerRow[]>([]);
  const [mergeTargetsLoading, setMergeTargetsLoading] = useState(false);
  const [fixtureSaving, setFixtureSaving] = useState(false);
  const [competitionSaving, setCompetitionSaving] = useState(false);
  const [squadSaving, setSquadSaving] = useState(false);
  const [mergeSaving, setMergeSaving] = useState(false);
  const [mergingTeams, setMergingTeams] = useState<MergeTeamsState | null>(null);
  const [teamMergeQ, setTeamMergeQ] = useState("");
  const [teamMergePlan, setTeamMergePlan] = useState<AdminSbTeamMergePlan | null>(null);
  const [teamMergePlanError, setTeamMergePlanError] = useState("");
  const [teamMergePlanLoading, setTeamMergePlanLoading] = useState(false);
  const [teamMergeSaving, setTeamMergeSaving] = useState(false);
  const [teamModal, setTeamModal] = useState<"create" | "edit" | null>(null);
  const [editingTeam, setEditingTeam] = useState<AdminSbTeam | null>(null);
  const [competitionOptions, setCompetitionOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [loading, setLoading] = useState<Record<Tab, boolean>>({
    competitions: false,
    teams: false,
    fixtures: false,
    players: false,
    nameQa: false,
    seeders: false,
  });
  const loadedRef = useRef<Record<Tab, boolean>>({
    competitions: false,
    teams: false,
    fixtures: false,
    players: false,
    nameQa: false,
    seeders: false,
  });

  const debouncedMergeTargetQ = useDebouncedValue(mergeTargetQ);

  /*
   * One fetch per tab, and every filter answered from what came back.
   *
   * These loaders used to take the filters as arguments, so each had the filter state in its
   * `useCallback` deps and the effect below re-ran on every change: a status dropdown, a
   * competition picker or a pause in typing was a round trip. None of these endpoints
   * paginate -- they return every competition, team, fixture and squad row there is -- so the
   * browser was asking the server to filter a list it already held in full.
   *
   * The directory search was worse than slow. `GET players?q=` caps a search at 500 rows and
   * returns everything when asked for nothing, so searching a common surname could show fewer
   * players than scrolling the unfiltered list. Filtering in the browser searches all of them,
   * and searches the club and competition names too, which the server query never did.
   */
  const loadCompetitions = useCallback(async () => {
    setLoading((s) => ({ ...s, competitions: true }));
    try {
      const rows = await adminScoreboardApi.competitions();
      setCompetitions(rows);
      loadedRef.current.competitions = true;
    } catch {
      setCompetitions([]);
    } finally {
      setLoading((s) => ({ ...s, competitions: false }));
    }
  }, []);

  const loadTeams = useCallback(async () => {
    setLoading((s) => ({ ...s, teams: true }));
    try {
      const rows = await adminScoreboardApi.teams();
      setTeams(rows);
      loadedRef.current.teams = true;
    } catch {
      setTeams([]);
    } finally {
      setLoading((s) => ({ ...s, teams: false }));
    }
  }, []);

  const loadFixtures = useCallback(async () => {
    setLoading((s) => ({ ...s, fixtures: true }));
    try {
      const rows = await adminScoreboardApi.matches();
      setFixtures(sortRosterMatches(rows));
      loadedRef.current.fixtures = true;
    } catch {
      setFixtures([]);
    } finally {
      setLoading((s) => ({ ...s, fixtures: false }));
    }
  }, []);

  const loadPlayers = useCallback(async () => {
    setLoading((s) => ({ ...s, players: true }));
    try {
      const rows = await adminScoreboardApi.players();
      setPlayers(rows);
      loadedRef.current.players = true;
      loadedRef.current.nameQa = true;
    } catch {
      setPlayers([]);
    } finally {
      setLoading((s) => ({ ...s, players: false }));
    }
  }, []);

  const openFixtureEditor = (match: SbMatchListItem) => {
    const parts = kickoffAtToWatParts(match.kickoffAt);
    setEditingFixture({
      match,
      venue: match.venue ?? "",
      kickoffDate: parts.date,
      kickoffTime: parts.time,
      roundLabel: match.roundLabel ?? "",
    });
  };

  const openCompetitionEditor = (competition: AdminSbCompetition) => {
    setEditingCompetition({
      competition,
      draft: {
        name: competition.name,
        slug: competition.slug,
        season: competition.season,
        type: competition.type,
        status: competition.status,
        formatType: competition.formatType ?? "",
        country: competition.region ?? "",
        description: competition.description ?? "",
        isPublished: competition.isPublished,
        logoUrl: competition.logoUrl ?? "",
        isFeatured: competition.isFeatured,
      },
    });
  };

  const openSquadEditor = (row: AdminSbPlayerDirectoryRow) => {
    const team = row.teams[0];
    if (!team) return;
    setEditingSquadRow({
      row,
      squadId: team.squadId,
      draft: {
        teamId: team.teamId,
        displayName: row.displayName,
        position: team.position ?? row.positionPrimary ?? "",
        shirtNumber: team.shirtNumber,
      },
    });
  };

  const openPlayerMerge = (source: AdminSbPlayerDirectoryRow) => {
    if (!source.playerId) {
      toast.error("Edit this row first so it links to a player profile before merging.");
      return;
    }
    const sourceKey = normalizeNameKey(source.displayName);
    /* Only a same-name profile is offered in advance. Falling back to "any other
       player" pre-selected someone unrelated, one click away from a wrong merge. */
    const suggestedTarget = players.find(
      (player) =>
        player.playerId &&
        player.playerId !== source.playerId &&
        normalizeNameKey(player.displayName) === sourceKey
    );
    setMergingPlayers({
      source,
      targetPlayerId: suggestedTarget?.playerId ?? "",
      removeSource: true,
    });
    setMergeTargetQ(source.displayName);
    setMergeMasterTargets([]);
  };

  const saveCompetitionEdit = async () => {
    if (!editingCompetition) return;
    const draft = editingCompetition.draft;
    if (!draft.name.trim() || !draft.season.trim()) {
      toast.error("Competition name and season are required");
      return;
    }

    setCompetitionSaving(true);
    try {
      await adminScoreboardApi.updateCompetition(editingCompetition.competition.id, {
        ...draft,
        name: draft.name.trim(),
        slug: draft.slug?.trim() || undefined,
        season: draft.season.trim(),
        type: draft.type.trim() || "tournament",
        status: draft.status,
        formatType: draft.formatType?.trim() || undefined,
        country: draft.country?.trim() || undefined,
        /* Sent even when empty, so clearing the description or the crest sticks. */
        description: draft.description?.trim() ?? "",
        logoUrl: draft.logoUrl?.trim() ?? "",
      });
      toast.success("Competition updated");
      setEditingCompetition(null);
      loadedRef.current.competitions = false;
      void loadCompetitions();
      /* The picker lists competitions by name, so a rename has to reach it too. */
      void loadCompetitionOptions();
      void refreshStats();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setCompetitionSaving(false);
    }
  };

  const saveSquadEdit = async () => {
    if (!editingSquadRow) return;
    const draft = editingSquadRow.draft;
    if (!draft.displayName.trim()) {
      toast.error("Player name is required");
      return;
    }

    setSquadSaving(true);
    try {
      const updated = await adminScoreboardApi.updateSquadRow(editingSquadRow.squadId, {
        teamId: draft.teamId,
        displayName: draft.displayName.trim(),
        position: draft.position?.trim() || undefined,
        shirtNumber:
          draft.shirtNumber == null || Number.isNaN(Number(draft.shirtNumber))
            ? null
            : Number(draft.shirtNumber),
      });
      setPlayers((rows) =>
        rows.map((row) =>
          row.teams.some((team) => team.squadId === updated.squadId)
            ? {
                ...row,
                playerId: updated.playerId,
                slug: updated.slug,
                displayName: updated.displayName,
                positionPrimary: updated.positionPrimary,
                teams: row.teams.map((team) =>
                  team.squadId === updated.squadId ? updated.teams[0] : team
                ),
              }
            : row
        )
      );
      toast.success("Scoreboard player updated");
      setEditingSquadRow(null);
      void loadPlayers();
      void refreshStats();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setSquadSaving(false);
    }
  };

  const savePlayerMerge = async () => {
    if (!mergingPlayers?.source.playerId || !mergingPlayers.targetPlayerId) {
      toast.error("Choose the duplicate source and canonical target profile.");
      return;
    }
    setMergeSaving(true);
    try {
      const source = mergingPlayers.source;
      const result = await adminScoreboardApi.mergePlayers({
        sourcePlayerId: source.playerId,
        targetPlayerId: mergingPlayers.targetPlayerId,
        sourceSquadId: source.teams[0]?.squadId,
        removeSource: mergingPlayers.removeSource,
      });
      toast.success(
        `Merged ${result.source.displayName} into ${result.target.displayName}. Events moved: ${
          result.moved.eventPlayer +
          result.moved.eventAssist +
          result.moved.labeledPrimaryEvents +
          result.moved.labeledAssistEvents
        }`
      );
      setMergingPlayers(null);
      void loadPlayers();
      void refreshStats();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setMergeSaving(false);
    }
  };

  const openTeamMerge = (source: AdminSbTeam) => {
    setMergingTeams({ source, targetTeamId: "" });
    /* Starts on the club's own name, so its other entries are the first offered. */
    setTeamMergeQ(source.name.replace(/\b(f\.?c|fa|sc)\b\.?/gi, "").trim() || source.name);
    setTeamMergePlan(null);
    setTeamMergePlanError("");
  };

  const saveTeamMerge = async () => {
    if (!mergingTeams?.targetTeamId || !teamMergePlan || teamMergePlan.blocked) return;
    setTeamMergeSaving(true);
    try {
      const result = await adminScoreboardApi.mergeTeams({
        sourceTeamId: mergingTeams.source.id,
        targetTeamId: mergingTeams.targetTeamId,
      });
      toast.success(
        result.mode === "absorb"
          ? `Merged ${result.source.name} into ${result.target.name}: ${
              result.moved.homeFixtures + result.moved.awayFixtures
            } fixture(s), ${result.moved.squadMoved + result.moved.squadFolded} squad row(s) and ${
              result.moved.events
            } event(s) moved.`
          : `${result.source.name} (${result.source.competition}) is now linked to ${result.target.name} as one club.`
      );
      setMergingTeams(null);
      loadedRef.current.teams = false;
      void loadTeams();
      if (optionsLoadedRef.current.teams) void loadTeamOptions();
      void refreshStats();
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setTeamMergeSaving(false);
    }
  };

  const saveFixtureEdit = async () => {
    if (!editingFixture) return;
    if (!editingFixture.kickoffDate || !editingFixture.kickoffTime) {
      toast.error("Kickoff date and time are required (WAT)");
      return;
    }

    setFixtureSaving(true);
    try {
      const res = await adminScoreboardApi.patchMatchGameday(editingFixture.match.id, {
        venue: editingFixture.venue,
        kickoffDate: editingFixture.kickoffDate,
        kickoffTime: editingFixture.kickoffTime,
        roundLabel: editingFixture.roundLabel,
      });
      setFixtures((rows) =>
        rows.map((row) =>
          row.id === editingFixture.match.id
            ? {
                ...row,
                venue: res.match.venue,
                kickoffAt: res.match.kickoffAt,
                roundLabel: res.match.roundLabel,
              }
            : row
        )
      );
      toast.success("Fixture details updated");
      setEditingFixture(null);
    } catch (e) {
      toast.error(formatAdminScoreboardError(e));
    } finally {
      setFixtureSaving(false);
    }
  };

  const loadPicker = useCallback(async () => {
    setLoading((s) => ({ ...s, seeders: true }));
    try {
      const rows = await adminScoreboardApi.competitionPicker();
      setPicker(rows);
      if (rows[0] && !seedCompId) setSeedCompId(rows[0].id);
      loadedRef.current.seeders = true;
    } finally {
      setLoading((s) => ({ ...s, seeders: false }));
    }
  }, [seedCompId]);

  useEffect(() => {
    if (tab === "competitions") void loadCompetitions();
  }, [tab, loadCompetitions]);

  /* The competition picker and the team list fill filter dropdowns and modal selects. Both
     were refetched on every tab switch and every time a modal opened -- four requests to
     open and close one dialog. They change when somebody creates a competition or a team,
     which the handlers that do that already reload, so once is enough. */
  const optionsLoadedRef = useRef({ competitions: false, teams: false });

  const loadCompetitionOptions = useCallback(async () => {
    optionsLoadedRef.current.competitions = true;
    try {
      setCompetitionOptions(await adminScoreboardApi.competitionPicker());
    } catch {
      /* Left unloaded so entering the tab again tries once more. */
      optionsLoadedRef.current.competitions = false;
    }
  }, []);

  const loadTeamOptions = useCallback(async () => {
    optionsLoadedRef.current.teams = true;
    try {
      setPlayerTeamOptions(await adminScoreboardApi.teams());
    } catch {
      optionsLoadedRef.current.teams = false;
      setPlayerTeamOptions([]);
    }
  }, []);

  useEffect(() => {
    const wanted = tab === "teams" || tab === "fixtures" || teamModal !== null || fixtureOpen;
    if (wanted && !optionsLoadedRef.current.competitions) void loadCompetitionOptions();
  }, [tab, teamModal, fixtureOpen, loadCompetitionOptions]);

  useEffect(() => {
    if (tab === "teams") void loadTeams();
  }, [tab, loadTeams]);

  useEffect(() => {
    if (tab === "fixtures") void loadFixtures();
  }, [tab, loadFixtures]);

  useEffect(() => {
    if (tab === "players" || tab === "nameQa") void loadPlayers();
  }, [tab, loadPlayers]);

  useEffect(() => {
    const sourceName = mergingPlayers?.source.displayName;
    if (!sourceName) {
      setMergeMasterTargets([]);
      setMergeTargetsLoading(false);
      return;
    }

    const query = debouncedMergeTargetQ.trim() || sourceName;
    let cancelled = false;
    setMergeTargetsLoading(true);
    adminApi
      .players({
        q: query,
        sort: "name",
        sortDir: "asc",
        limit: 40,
      })
      .then((page) => {
        if (!cancelled) setMergeMasterTargets(page.items);
      })
      .catch(() => {
        if (!cancelled) setMergeMasterTargets([]);
      })
      .finally(() => {
        if (!cancelled) setMergeTargetsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedMergeTargetQ, mergingPlayers?.source.displayName]);

  useEffect(() => {
    const sourceTeamId = mergingTeams?.source.id;
    const targetTeamId = mergingTeams?.targetTeamId;
    setTeamMergePlan(null);
    setTeamMergePlanError("");
    if (!sourceTeamId || !targetTeamId) return;
    let cancelled = false;
    setTeamMergePlanLoading(true);
    adminScoreboardApi
      .previewTeamMerge({ sourceTeamId, targetTeamId })
      .then((plan) => {
        if (!cancelled) setTeamMergePlan(plan);
      })
      .catch((e) => {
        if (!cancelled) setTeamMergePlanError(formatAdminScoreboardError(e));
      })
      .finally(() => {
        if (!cancelled) setTeamMergePlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mergingTeams?.source.id, mergingTeams?.targetTeamId]);

  useEffect(() => {
    if (tab !== "players" && tab !== "nameQa") return;
    if (!optionsLoadedRef.current.teams) void loadTeamOptions();
  }, [tab, loadTeamOptions]);

  useEffect(() => {
    if (tab === "seeders" && !loadedRef.current.seeders) void loadPicker();
  }, [tab, loadPicker]);

  const playerPath = (slug: string | null, displayName: string) =>
    slug ? `/player/${slug}` : `/player/${encodeURIComponent(displayName.toLowerCase().replace(/\s+/g, "-"))}`;

  /*
   * Searchable text is built once per dataset and the filters run over that.
   *
   * It used to be assembled inside the filter callback -- seven fields joined and lowercased per
   * fixture per render -- so the cost of a keystroke was the whole table rebuilt as strings. The
   * rules themselves live in `records-filtering.ts`, where they are tested.
   */
  const competitionIndex = useMemo(
    () => indexForSearch(competitions, competitionSearchText),
    [competitions]
  );
  const teamIndex = useMemo(() => indexForSearch(teams, teamSearchText), [teams]);
  const fixtureIndex = useMemo(() => indexForSearch(fixtures, fixtureSearchText), [fixtures]);
  const playerIndex = useMemo(() => indexForSearch(players, playerSearchText), [players]);

  const nameQaRows = useMemo(() => nameQaRowsFor(players), [players]);
  const nameQaIndex = useMemo(() => indexForSearch(nameQaRows, nameQaSearchText), [nameQaRows]);
  const nameQaFlagOptions = useMemo(() => nameQaFlagOptionsFor(nameQaRows), [nameQaRows]);
  const teamGroupOptions = useMemo(() => teamGroupOptionsFor(teams), [teams]);

  const filteredCompetitions = useMemo(
    () =>
      filterIndexed(
        competitionIndex,
        searchNeedle(q),
        keepCompetition({
          status: statusFilter,
          type: typeFilter,
          published: publishedFilter,
          featured: featuredFilter,
        })
      ),
    [competitionIndex, featuredFilter, publishedFilter, q, statusFilter, typeFilter]
  );

  const filteredTeams = useMemo(
    () =>
      filterIndexed(
        teamIndex,
        searchNeedle(teamQ),
        keepTeam({ competitionId: teamCompId, groupKey: teamGroupFilter })
      ),
    [teamCompId, teamGroupFilter, teamIndex, teamQ]
  );

  const filteredFixtures = useMemo(
    () =>
      filterIndexed(
        fixtureIndex,
        searchNeedle(fixtureQ),
        keepFixture({ competitionId: fixtureCompId, status: fixtureStatusFilter })
      ),
    [fixtureCompId, fixtureIndex, fixtureQ, fixtureStatusFilter]
  );

  const filteredPlayers = useMemo(
    () =>
      filterIndexed(
        playerIndex,
        searchNeedle(playerQ),
        keepPlayer({
          teamId: playerTeamFilter,
          position: playerPositionFilter,
          link: playerLinkFilter,
        })
      ),
    [playerIndex, playerLinkFilter, playerPositionFilter, playerQ, playerTeamFilter]
  );

  const filteredNameQaRows = useMemo(
    () =>
      filterIndexed(
        nameQaIndex,
        searchNeedle(playerQ),
        keepNameQaRow({ flag: nameQaFlagFilter, teamId: playerTeamFilter })
      ),
    [nameQaFlagFilter, nameQaIndex, playerQ, playerTeamFilter]
  );
  /*
   * Rows picked for a bulk action, one selection per tab.
   *
   * Selection is by the id the row is acted on by, which for the directory is the squad row
   * rather than the player: a profile can sit in several clubs, and this page edits and deletes
   * the club entry. A row with no squad row behind it cannot be selected at all.
   *
   * Each selection is pruned to what the filter shows, which is the guarantee that makes
   * "Select all" safe to press -- see `row-selection.ts`. Players and Name QA keep separate
   * selections even though both act on squad rows, because carrying a selection between two
   * differently filtered lists is how somebody deletes rows they never looked at.
   */
  const [competitionSel, setCompetitionSel] = useState<Selection>(EMPTY_SELECTION);
  const [teamSel, setTeamSel] = useState<Selection>(EMPTY_SELECTION);
  const [fixtureSel, setFixtureSel] = useState<Selection>(EMPTY_SELECTION);
  const [playerSel, setPlayerSel] = useState<Selection>(EMPTY_SELECTION);
  const [nameQaSel, setNameQaSel] = useState<Selection>(EMPTY_SELECTION);
  const [bulkBusy, setBulkBusy] = useState(false);

  const competitionIds = useMemo(
    () => filteredCompetitions.map((c) => c.id),
    [filteredCompetitions]
  );
  const teamIds = useMemo(() => filteredTeams.map((t) => t.id), [filteredTeams]);
  const fixtureIds = useMemo(() => filteredFixtures.map((m) => m.id), [filteredFixtures]);
  const playerSquadIds = useMemo(
    () => filteredPlayers.map(squadIdOf).filter((id): id is string => id !== null),
    [filteredPlayers]
  );
  const nameQaSquadIds = useMemo(
    () =>
      filteredNameQaRows
        .map((row) => squadIdOf(row.player))
        .filter((id): id is string => id !== null),
    [filteredNameQaRows]
  );

  /* `pruneToVisible` hands back the same Set when it dropped nothing, so these do not render
     for a filter change that touched no selected row. */
  useEffect(
    () => setCompetitionSel((sel) => pruneToVisible(sel, competitionIds)),
    [competitionIds]
  );
  useEffect(() => setTeamSel((sel) => pruneToVisible(sel, teamIds)), [teamIds]);
  useEffect(() => setFixtureSel((sel) => pruneToVisible(sel, fixtureIds)), [fixtureIds]);
  useEffect(() => setPlayerSel((sel) => pruneToVisible(sel, playerSquadIds)), [playerSquadIds]);
  useEffect(() => setNameQaSel((sel) => pruneToVisible(sel, nameQaSquadIds)), [nameQaSquadIds]);

  /**
   * Confirm, run, report, and leave the rows that refused still selected.
   *
   * Every one of these actions partially succeeds -- the server puts each row through the same
   * guard the single-row delete uses -- so the selection afterwards is the rows that did not go
   * through. That way "try the rest" is a glance at the table rather than a hunt through it.
   */
  const runBulk = useCallback(
    async (args: {
      noun: Noun;
      verb: string;
      pastTense: string;
      ids: string[];
      names: string[];
      caveat?: string;
      act: (batch: string[]) => Promise<AdminSbBulkResult>;
      setSelection: (next: Selection) => void;
      reload: () => void;
    }) => {
      if (!args.ids.length) return;
      const asked = confirmBulk({
        verb: args.verb,
        noun: args.noun,
        names: args.names,
        caveat: args.caveat,
      });
      if (!window.confirm(asked)) return;

      setBulkBusy(true);
      try {
        /* Split into requests the server will accept. The directory tab lists every squad
           row there is, so "Select all shown" is thousands of ids and one request would be
           refused outright. */
        const result = await runInBatches(args.ids, args.act);
        const report = reportBulk(result, args.noun, args.pastTense);
        if (report.ok) toast.success(report.ok);
        if (report.problem) toast.error(report.problem);
        args.setSelection(new Set(result.failures.map((failure) => failure.id)));
        args.reload();
        void refreshStats();
      } catch (err) {
        toast.error(formatAdminScoreboardError(err));
      } finally {
        setBulkBusy(false);
      }
    },
    [refreshStats, toast]
  );

  /** A checkbox column header, shared by every tab that has one. */
  const selectAllCell = (args: {
    label: string;
    selection: Selection;
    visibleIds: string[];
    onToggle: () => void;
  }) => (
    <th className="admin-sb-select-cell">
      <input
        type="checkbox"
        aria-label={args.label}
        checked={allOfSelected(args.selection, args.visibleIds)}
        /* The dash state, for a partial selection. React has no prop for it. */
        ref={(node) => {
          if (node) node.indeterminate = someVisibleSelected(args.selection, args.visibleIds);
        }}
        disabled={args.visibleIds.length === 0}
        onChange={args.onToggle}
      />
    </th>
  );

  /** A row checkbox. `id` is null for a row with nothing to act on, and then it is disabled. */
  const selectRowCell = (args: {
    id: string | null;
    label: string;
    selection: Selection;
    onToggle: (id: string) => void;
  }) => (
    <td className="admin-sb-select-cell">
      <input
        type="checkbox"
        aria-label={args.label}
        checked={args.id !== null && args.selection.has(args.id)}
        disabled={args.id === null}
        title={args.id === null ? "This row has no squad entry to act on" : undefined}
        onChange={() => args.id && args.onToggle(args.id)}
      />
    </td>
  );

  /* Names for the confirmation dialogs, by the id the row is selected under. Built from the
     whole dataset rather than the filtered rows, so a selection made under an earlier filter
     still has a name to show. */
  const competitionNameById = useMemo(
    () => new Map(competitions.map((c) => [c.id, c.name])),
    [competitions]
  );
  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);
  const fixtureNameById = useMemo(
    () => new Map(fixtures.map((m) => [m.id, `${m.homeTeam.name} vs ${m.awayTeam.name}`])),
    [fixtures]
  );
  const playerNameBySquadId = useMemo(() => {
    const names = new Map<string, string>();
    for (const player of players) {
      for (const team of player.teams) names.set(team.squadId, player.displayName);
    }
    return names;
  }, [players]);

  const namesFor = (ids: string[], lookup: Map<string, string>) =>
    ids.map((id) => lookup.get(id) ?? id);

  const COMPETITION_NOUN: Noun = { one: "competition", many: "competitions" };
  const TEAM_NOUN: Noun = { one: "team", many: "teams" };
  const FIXTURE_NOUN: Noun = { one: "fixture", many: "fixtures" };
  const SQUAD_NOUN: Noun = { one: "squad row", many: "squad rows" };

  const selectedCompetitionIds = selectedInOrder(competitionSel, competitionIds);
  const selectedTeamIds = selectedInOrder(teamSel, teamIds);
  const selectedFixtureIds = selectedInOrder(fixtureSel, fixtureIds);
  const selectedPlayerSquadIds = selectedInOrder(playerSel, playerSquadIds);
  const selectedNameQaSquadIds = selectedInOrder(nameQaSel, nameQaSquadIds);

  /* The directory's bulk delete is the one that already had a server endpoint, from the squad
     management page. It returns a count rather than per-row outcomes, so it is adapted to the
     shape the rest report in: a squad row has no guard to refuse it, and `deleted` short of
     what was asked means some rows were gone before the request arrived. */
  const deleteSquadRows = async (squadIds: string[]): Promise<AdminSbBulkResult> => {
    const { deleted } = await adminScoreboardApi.deleteSquads({ squadIds });
    return { requested: squadIds.length, done: deleted, failures: [] };
  };

  const competitionBulkActions: BulkAction[] = [
    {
      label: "Publish",
      onRun: () =>
        runBulk({
          noun: COMPETITION_NOUN,
          verb: "Publish",
          pastTense: "published",
          ids: selectedCompetitionIds,
          names: namesFor(selectedCompetitionIds, competitionNameById),
          caveat: "Published competitions are visible on the public ScoreBoard.",
          act: (ids) => adminScoreboardApi.setCompetitionsPublished(ids, true),
          setSelection: setCompetitionSel,
          reload: () => void loadCompetitions(),
        }),
    },
    {
      label: "Unpublish",
      onRun: () =>
        runBulk({
          noun: COMPETITION_NOUN,
          verb: "Unpublish",
          pastTense: "unpublished",
          ids: selectedCompetitionIds,
          names: namesFor(selectedCompetitionIds, competitionNameById),
          caveat: "These competitions and their fixtures leave the public ScoreBoard.",
          act: (ids) => adminScoreboardApi.setCompetitionsPublished(ids, false),
          setSelection: setCompetitionSel,
          reload: () => void loadCompetitions(),
        }),
    },
    {
      label: "Delete",
      danger: true,
      onRun: () =>
        runBulk({
          noun: COMPETITION_NOUN,
          verb: "Delete",
          pastTense: "deleted",
          ids: selectedCompetitionIds,
          names: namesFor(selectedCompetitionIds, competitionNameById),
          caveat:
            "A competition that still has teams, fixtures, highlights or player stats is left alone — remove those first.",
          act: (ids) => adminScoreboardApi.deleteCompetitions(ids),
          setSelection: setCompetitionSel,
          reload: () => {
            void loadCompetitions();
            void loadCompetitionOptions();
          },
        }),
    },
  ];

  const teamBulkActions: BulkAction[] = [
    {
      label: "Delete",
      danger: true,
      onRun: () =>
        runBulk({
          noun: TEAM_NOUN,
          verb: "Delete",
          pastTense: "deleted",
          ids: selectedTeamIds,
          names: namesFor(selectedTeamIds, teamNameById),
          caveat: "A team linked to any fixture is left alone — delete its fixtures first.",
          act: (ids) => adminScoreboardApi.deleteTeams(ids),
          setSelection: setTeamSel,
          reload: () => {
            void loadTeams();
            if (optionsLoadedRef.current.teams) void loadTeamOptions();
          },
        }),
    },
  ];

  const fixtureBulkActions: BulkAction[] = [
    {
      label: "Delete",
      danger: true,
      onRun: () =>
        runBulk({
          noun: FIXTURE_NOUN,
          verb: "Delete",
          pastTense: "deleted",
          ids: selectedFixtureIds,
          names: namesFor(selectedFixtureIds, fixtureNameById),
          caveat: "A fixture that is live or at halftime is left alone.",
          act: (ids) => adminScoreboardApi.deleteMatches(ids),
          setSelection: setFixtureSel,
          reload: () => void loadFixtures(),
        }),
    },
  ];

  const squadBulkActions = (
    ids: string[],
    setSelection: (next: Selection) => void
  ): BulkAction[] => [
    {
      label: "Delete",
      danger: true,
      onRun: () =>
        runBulk({
          noun: SQUAD_NOUN,
          verb: "Remove",
          pastTense: "removed",
          ids,
          names: namesFor(ids, playerNameBySquadId),
          caveat:
            "This removes the club entry, not the player profile. Goals already credited to the player stay with them.",
          act: deleteSquadRows,
          setSelection,
          reload: () => void loadPlayers(),
        }),
    },
  ];

  const mergeTargetOptions = useMemo(() => {
    const sourcePlayerId = mergingPlayers?.source.playerId;
    const byId = new Map<string, MergeTargetOption>();

    for (const player of players) {
      if (!player.playerId || player.playerId === sourcePlayerId) continue;
      byId.set(player.playerId, {
        playerId: player.playerId,
        displayName: player.displayName,
        slug: player.slug,
        positionPrimary: player.positionPrimary,
        context: player.teams.length
          ? player.teams
              .map((team) => `${team.teamName} (${team.competitionName})`)
              .join(", ")
          : "ScoreBoard player",
        source: "scoreboard",
      });
    }

    for (const player of mergeMasterTargets) {
      if (!player.id || player.id === sourcePlayerId || byId.has(player.id)) continue;
      byId.set(player.id, {
        playerId: player.id,
        displayName: player.displayName,
        slug: player.slug,
        positionPrimary: player.positionPrimary,
        context: player.academy?.name
          ? `${player.academy.name} - master player profile`
          : "Master player profile",
        source: "players",
      });
    }

    const exactName = normalizeNameKey(mergingPlayers?.source.displayName ?? "");
    return [...byId.values()].sort((a, b) => {
      const aExact = normalizeNameKey(a.displayName) === exactName ? 0 : 1;
      const bExact = normalizeNameKey(b.displayName) === exactName ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [mergeMasterTargets, mergingPlayers?.source.displayName, mergingPlayers?.source.playerId, players]);

  const teamMergeOptions = useMemo(() => {
    const source = mergingTeams?.source;
    if (!source) return [];
    /* Same competition first: those are the true duplicates, merged into one. */
    return teams
      .filter((t) => t.id !== source.id)
      .map((t) => ({
        id: t.id,
        label: t.name,
        detail: `${t.competition.name} · ${t.slug} · ${t.squadCount} in squad`,
        badge: t.competition.id === source.competition.id ? "Same competition" : undefined,
        sameCompetition: t.competition.id === source.competition.id,
      }))
      .sort(
        (a, b) =>
          Number(b.sameCompetition) - Number(a.sameCompetition) || a.label.localeCompare(b.label)
      );
  }, [mergingTeams?.source, teams]);

  const mergeTargetSearchOptions = useMemo(
    () =>
      mergeTargetOptions.map((player) => ({
        id: player.playerId,
        label: player.positionPrimary
          ? `${player.displayName} (${player.positionPrimary})`
          : player.displayName,
        detail: player.context,
        badge: player.source === "players" ? "Player database" : undefined,
      })),
    [mergeTargetOptions]
  );

  return (
    <section className="admin-sb-section">
      <AdminSbPageHeader
        title="Master records"
        description="Competitions, clubs, player directory, and CSV import/export tools."
        crumbs={[{ label: "Entities" }]}
        actions={
          tab === "competitions" ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              Create competition
            </button>
          ) : tab === "teams" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditingTeam(null);
                setTeamModal("create");
              }}
            >
              Create team
            </button>
          ) : tab === "fixtures" ? (
            <button type="button" className="btn btn-primary" onClick={() => setFixtureOpen(true)}>
              Create fixture
            </button>
          ) : undefined
        }
      />

      <div className="admin-sb-tabs admin-sb-tabs--pill" role="tablist">
        {(
          [
            ["competitions", "Competitions"],
            ["teams", "Teams"],
            ["fixtures", "Fixtures"],
            ["players", "Players"],
            ["nameQa", "Name QA"],
            ["seeders", "CSV seeders"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "admin-sb-tab active" : "admin-sb-tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <CreateCompetitionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          toast.success("Competition created");
          loadedRef.current.competitions = false;
          void loadCompetitions();
          void loadCompetitionOptions();
          void refreshStats();
        }}
      />

      <TeamFormModal
        open={teamModal !== null}
        mode={teamModal === "edit" ? "edit" : "create"}
        team={editingTeam}
        competitions={competitionOptions}
        onClose={() => {
          setTeamModal(null);
          setEditingTeam(null);
        }}
        onSaved={() => {
          toast.success(teamModal === "edit" ? "Team updated" : "Team created");
          loadedRef.current.teams = false;
          void loadTeams();
          /* The player filters list teams by name. */
          if (optionsLoadedRef.current.teams) void loadTeamOptions();
          void refreshStats();
        }}
      />

      <FixtureFormModal
        open={fixtureOpen}
        competitions={competitionOptions}
        initialCompetitionId={fixtureCompId || undefined}
        onClose={() => setFixtureOpen(false)}
        onCreated={() => {
          loadedRef.current.fixtures = false;
          void loadFixtures();
          void refreshStats();
        }}
      />

      {editingCompetition && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!competitionSaving) setEditingCompetition(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="competition-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="competition-edit-title">Edit competition</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setEditingCompetition(null)}
                disabled={competitionSaving}
                aria-label="Close competition editor"
              >
                ×
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveCompetitionEdit();
              }}
            >
              <label className="admin-sb-field">
                <span>Name</span>
                <input
                  value={editingCompetition.draft.name}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, name: e.target.value } }
                        : current
                    )
                  }
                  required
                />
              </label>
              <label className="admin-sb-field">
                <span>Slug</span>
                <input
                  value={editingCompetition.draft.slug ?? ""}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, slug: e.target.value } }
                        : current
                    )
                  }
                />
              </label>
              <div className="admin-sb-gameday__datetime">
                <label className="admin-sb-field">
                  <span>Season</span>
                  <input
                    value={editingCompetition.draft.season}
                    onChange={(e) =>
                      setEditingCompetition((current) =>
                        current
                          ? { ...current, draft: { ...current.draft, season: e.target.value } }
                          : current
                      )
                    }
                    required
                  />
                </label>
                <label className="admin-sb-field">
                  <span>Type</span>
                  <select
                    value={editingCompetition.draft.type}
                    onChange={(e) =>
                      setEditingCompetition((current) =>
                        current
                          ? { ...current, draft: { ...current.draft, type: e.target.value } }
                          : current
                      )
                    }
                  >
                    {COMPETITION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="admin-sb-field">
                <span>Format</span>
                <input
                  value={editingCompetition.draft.formatType ?? ""}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, formatType: e.target.value } }
                        : current
                    )
                  }
                />
              </label>
              <label className="admin-sb-field">
                <span>Status</span>
                <select
                  value={editingCompetition.draft.status ?? "scheduled"}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? {
                            ...current,
                            draft: {
                              ...current.draft,
                              status: e.target.value as AdminSbCompetitionInput["status"],
                            },
                          }
                        : current
                    )
                  }
                >
                  {COMPETITION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-sb-field">
                <span>Country / region</span>
                <input
                  value={editingCompetition.draft.country ?? ""}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, country: e.target.value } }
                        : current
                    )
                  }
                />
              </label>
              <div className="admin-sb-field">
                <span>Logo URL</span>
                <div className="admin-sb-team-cell">
                  {editingCompetition.draft.logoUrl?.trim() ? (
                    <img
                      src={editingCompetition.draft.logoUrl.trim()}
                      alt="Logo preview"
                      className="admin-sb-comp-logo-preview"
                    />
                  ) : null}
                  <input
                    type="url"
                    inputMode="url"
                    className="admin-sb-comp-logo-input"
                    aria-label="Logo URL"
                    value={editingCompetition.draft.logoUrl ?? ""}
                    onChange={(e) =>
                      setEditingCompetition((current) =>
                        current
                          ? { ...current, draft: { ...current.draft, logoUrl: e.target.value } }
                          : current
                      )
                    }
                    placeholder="https://… (leave empty for no logo)"
                  />
                </div>
              </div>
              <label className="admin-sb-field">
                <span>Description</span>
                <textarea
                  rows={4}
                  value={editingCompetition.draft.description ?? ""}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, description: e.target.value } }
                        : current
                    )
                  }
                  placeholder="A short public description of the competition"
                />
              </label>
              <label className="admin-sb-check">
                <input
                  type="checkbox"
                  checked={Boolean(editingCompetition.draft.isFeatured)}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? {
                            ...current,
                            draft: { ...current.draft, isFeatured: e.target.checked },
                          }
                        : current
                    )
                  }
                />
                Featured
              </label>
              <label className="admin-sb-check">
                <input
                  type="checkbox"
                  checked={Boolean(editingCompetition.draft.isPublished)}
                  onChange={(e) =>
                    setEditingCompetition((current) =>
                      current
                        ? {
                            ...current,
                            draft: { ...current.draft, isPublished: e.target.checked },
                          }
                        : current
                    )
                  }
                />
                Published
              </label>
              <footer className="admin-sb-modal__footer">
                <button
                  type="button"
                  onClick={() => setEditingCompetition(null)}
                  disabled={competitionSaving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={competitionSaving}>
                  {competitionSaving ? "Saving..." : "Save competition"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {editingSquadRow && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!squadSaving) setEditingSquadRow(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="squad-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="squad-edit-title">Edit scoreboard player</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setEditingSquadRow(null)}
                disabled={squadSaving}
                aria-label="Close player editor"
              >
                ×
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveSquadEdit();
              }}
            >
              <label className="admin-sb-field">
                <span>Team</span>
                <select
                  value={editingSquadRow.draft.teamId ?? ""}
                  onChange={(e) =>
                    setEditingSquadRow((current) =>
                      current
                        ? { ...current, draft: { ...current.draft, teamId: e.target.value } }
                        : current
                    )
                  }
                >
                  {playerTeamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} · {team.competition.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-sb-field">
                <span>Display name</span>
                <input
                  value={editingSquadRow.draft.displayName}
                  onChange={(e) =>
                    setEditingSquadRow((current) =>
                      current
                        ? {
                            ...current,
                            draft: { ...current.draft, displayName: e.target.value },
                          }
                        : current
                    )
                  }
                  required
                />
              </label>
              <div className="admin-sb-gameday__datetime">
                <label className="admin-sb-field">
                  <span>Position</span>
                  <input
                    value={editingSquadRow.draft.position ?? ""}
                    onChange={(e) =>
                      setEditingSquadRow((current) =>
                        current
                          ? {
                              ...current,
                              draft: { ...current.draft, position: e.target.value },
                            }
                          : current
                      )
                    }
                    placeholder="GK, CB, RW..."
                  />
                </label>
                <label className="admin-sb-field">
                  <span>Shirt number</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={editingSquadRow.draft.shirtNumber ?? ""}
                    onChange={(e) =>
                      setEditingSquadRow((current) =>
                        current
                          ? {
                              ...current,
                              draft: {
                                ...current.draft,
                                shirtNumber: e.target.value === "" ? null : Number(e.target.value),
                              },
                            }
                          : current
                      )
                    }
                  />
                </label>
              </div>
              <footer className="admin-sb-modal__footer">
                <button type="button" onClick={() => setEditingSquadRow(null)} disabled={squadSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={squadSaving}>
                  {squadSaving ? "Saving..." : "Save player"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {mergingPlayers && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!mergeSaving) setMergingPlayers(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="player-merge-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="player-merge-title">Merge duplicate player names</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setMergingPlayers(null)}
                disabled={mergeSaving}
                aria-label="Close merge player modal"
              >
                x
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void savePlayerMerge();
              }}
            >
              <div className="admin-sb-merge-summary">
                <div>
                  <span className="muted">Duplicate source</span>
                  <strong>{mergingPlayers.source.displayName}</strong>
                  <small>
                    {mergingPlayers.source.teams
                      .map((team) => `${team.teamName} (${team.competitionName})`)
                      .join(", ") || "No club context"}
                  </small>
                </div>
                <div>
                  <span className="muted">What will move</span>
                  <strong>ScoreBoard history and events</strong>
                  <small>
                    Primary events, assist events, match squads, team squads, competition stats,
                    and linked performance rows move to the target profile.
                  </small>
                </div>
              </div>
              <SearchSelect
                label="Canonical target profile"
                options={mergeTargetSearchOptions}
                value={mergingPlayers.targetPlayerId}
                onChange={(playerId) =>
                  setMergingPlayers((current) => (current ? { ...current, targetPlayerId: playerId } : current))
                }
                query={mergeTargetQ}
                onQueryChange={setMergeTargetQ}
                loading={mergeTargetsLoading}
                disabled={mergeSaving}
                placeholder="Type a name, club or competition…"
                hint="Searches every ScoreBoard player and the full player database, so the profile to keep can have no ScoreBoard history yet."
              />
              <label className="admin-sb-check">
                <input
                  type="checkbox"
                  checked={mergingPlayers.removeSource}
                  onChange={(e) =>
                    setMergingPlayers((current) =>
                      current ? { ...current, removeSource: e.target.checked } : current
                    )
                  }
                />
                Delete the duplicate player profile after references are moved
              </label>
              <p className="admin-sb-warning-note">
                Review carefully: this is a database merge. The target profile becomes the single
                owner of the source player's ScoreBoard history.
              </p>
              <footer className="admin-sb-modal__footer">
                <button
                  type="button"
                  onClick={() => setMergingPlayers(null)}
                  disabled={mergeSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={mergeSaving || !mergingPlayers.targetPlayerId}
                >
                  {mergeSaving ? "Merging..." : "Merge players"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {mergingTeams && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!teamMergeSaving) setMergingTeams(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="team-merge-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="team-merge-title">Merge duplicate team</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setMergingTeams(null)}
                disabled={teamMergeSaving}
                aria-label="Close merge team dialog"
              >
                ×
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveTeamMerge();
              }}
            >
              <div className="admin-sb-merge-summary">
                <div>
                  <span className="muted">Duplicate</span>
                  <strong>{mergingTeams.source.name}</strong>
                  <small>
                    {mergingTeams.source.competition.name} · {mergingTeams.source.slug} ·{" "}
                    {mergingTeams.source.squadCount} in squad
                  </small>
                </div>
                <div>
                  <span className="muted">What happens</span>
                  <strong>Depends on the competition</strong>
                  <small>
                    Same competition: its fixtures, squad and events move to the team you keep, and the
                    duplicate is deleted. Another competition: both entries stay, linked as one club,
                    and the duplicate takes the kept team&apos;s name and logo.
                  </small>
                </div>
              </div>
              <SearchSelect
                label="Team to keep"
                options={teamMergeOptions}
                value={mergingTeams.targetTeamId}
                onChange={(teamId) =>
                  setMergingTeams((current) => (current ? { ...current, targetTeamId: teamId } : current))
                }
                query={teamMergeQ}
                onQueryChange={setTeamMergeQ}
                disabled={teamMergeSaving}
                placeholder="Type a club name or competition…"
              />
              {teamMergePlanLoading ? (
                <p className="muted">Checking what this merge would change…</p>
              ) : teamMergePlanError ? (
                <p className="admin-sb-warning-note">{teamMergePlanError}</p>
              ) : teamMergePlan ? (
                <div className="admin-sb-merge-plan" aria-live="polite">
                  {teamMergePlan.mode === "absorb" ? (
                    <>
                      <strong>
                        Fold {teamMergePlan.source.name} into {teamMergePlan.target.name} and delete
                        the duplicate
                      </strong>
                      <ul>
                        <li>{teamMergePlan.counts.fixtures} fixture(s) move</li>
                        <li>
                          {teamMergePlan.counts.squad} squad row(s) move; a player already in the kept
                          squad is combined, not listed twice
                        </li>
                        <li>{teamMergePlan.counts.events} match event(s) move</li>
                        <li>{teamMergePlan.counts.matchSquadPlayers} match-day squad entries move</li>
                        <li>
                          Match-day squads keep the shirt number each player wore in that match
                        </li>
                      </ul>
                      {teamMergePlan.shirtNumbers.clashes.length > 0 ? (
                        <div className="admin-sb-warning-note">
                          <strong>
                            Shirt number clashes ({teamMergePlan.shirtNumbers.clashes.length}): two
                            players would share these numbers.
                          </strong>{" "}
                          A goal entered by number would stay unattributed until one is changed in
                          the squad.
                          <ul>
                            {teamMergePlan.shirtNumbers.clashes.map((c) => (
                              <li key={`${c.number}-${c.incoming}`}>
                                #{c.number}: {c.kept} (kept) and {c.incoming} (moving)
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="muted">No shirt number clashes.</p>
                      )}
                      {teamMergePlan.shirtNumbers.renumbered.length > 0 ? (
                        <div className="admin-sb-warning-note">
                          <strong>Players on both teams with different numbers:</strong> the kept
                          team&apos;s number stays.
                          <ul>
                            {teamMergePlan.shirtNumbers.renumbered.map((r) => (
                              <li key={r.name}>
                                {r.name}: keeps #{r.kept} (#{r.dropped} on the duplicate)
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <strong>
                        Link as one club: {teamMergePlan.source.name} ({teamMergePlan.source.competition})
                        and {teamMergePlan.target.name} ({teamMergePlan.target.competition})
                      </strong>
                      <ul>
                        <li>Both entries stay. Each competition needs its own for its fixtures and table.</li>
                        <li>
                          The duplicate is renamed to &ldquo;{teamMergePlan.target.name}&rdquo; and takes
                          its logo.
                        </li>
                        <li>No fixtures, squads or events move between competitions.</li>
                        <li>
                          Shirt numbers are untouched: each competition keeps its own squad and
                          numbers.
                        </li>
                      </ul>
                    </>
                  )}
                  {teamMergePlan.blocked ? (
                    <p className="admin-sb-warning-note">{teamMergePlan.blocked}</p>
                  ) : null}
                </div>
              ) : null}
              <p className="admin-sb-warning-note">
                Review carefully: this changes the database and cannot be undone from here.
              </p>
              <footer className="admin-sb-modal__footer">
                <button type="button" onClick={() => setMergingTeams(null)} disabled={teamMergeSaving}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    teamMergeSaving ||
                    teamMergePlanLoading ||
                    !teamMergePlan ||
                    Boolean(teamMergePlan.blocked)
                  }
                >
                  {teamMergeSaving
                    ? "Merging…"
                    : teamMergePlan?.mode === "link"
                      ? "Link as one club"
                      : "Merge teams"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {editingFixture && (
        <div
          className="admin-sb-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!fixtureSaving) setEditingFixture(null);
          }}
        >
          <div
            className="admin-sb-modal"
            role="dialog"
            aria-labelledby="fixture-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="admin-sb-modal__header">
              <h2 id="fixture-edit-title">Edit fixture</h2>
              <button
                type="button"
                className="admin-sb-modal__close"
                onClick={() => setEditingFixture(null)}
                disabled={fixtureSaving}
                aria-label="Close fixture editor"
              >
                ×
              </button>
            </header>
            <form
              className="admin-sb-modal__body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveFixtureEdit();
              }}
            >
              <p className="admin-sb-modal__desc">
                {editingFixture.match.homeTeam.name} vs {editingFixture.match.awayTeam.name}
              </p>
              <div className="admin-sb-gameday__datetime">
                <label className="admin-sb-field">
                  <span>Date (WAT)</span>
                  <input
                    type="date"
                    value={editingFixture.kickoffDate}
                    onChange={(e) =>
                      setEditingFixture((current) =>
                        current ? { ...current, kickoffDate: e.target.value } : current
                      )
                    }
                    required
                  />
                </label>
                <label className="admin-sb-field">
                  <span>Kickoff time (WAT)</span>
                  <input
                    type="time"
                    value={editingFixture.kickoffTime}
                    onChange={(e) =>
                      setEditingFixture((current) =>
                        current ? { ...current, kickoffTime: e.target.value } : current
                      )
                    }
                    required
                  />
                </label>
              </div>
              <label className="admin-sb-field">
                <span>Venue</span>
                <input
                  type="text"
                  value={editingFixture.venue}
                  onChange={(e) =>
                    setEditingFixture((current) =>
                      current ? { ...current, venue: e.target.value } : current
                    )
                  }
                  maxLength={200}
                  placeholder="e.g. Onikan Stadium, Lagos"
                />
              </label>
              <label className="admin-sb-field">
                <span>Round</span>
                <input
                  type="text"
                  value={editingFixture.roundLabel}
                  onChange={(e) =>
                    setEditingFixture((current) =>
                      current ? { ...current, roundLabel: e.target.value } : current
                    )
                  }
                  maxLength={120}
                  placeholder="e.g. Round of 16, Matchday 3"
                />
              </label>
              <footer className="admin-sb-modal__footer">
                <button
                  type="button"
                  onClick={() => setEditingFixture(null)}
                  disabled={fixtureSaving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={fixtureSaving}>
                  {fixtureSaving ? "Saving…" : "Save fixture"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {tab === "competitions" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters admin-filters--with-action">
              <input
                type="search"
                placeholder="Search name, slug, region, season, format…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search competitions"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {COMPETITION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by type"
              >
                <option value="">All types</option>
                {COMPETITION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={publishedFilter}
                onChange={(e) => setPublishedFilter(e.target.value)}
                aria-label="Filter by publish state"
              >
                <option value="">Any publish state</option>
                <option value="published">Published</option>
                <option value="unpublished">Unpublished</option>
              </select>
              <select
                value={featuredFilter}
                onChange={(e) => setFeaturedFilter(e.target.value)}
                aria-label="Filter by featured state"
              >
                <option value="">Any featured state</option>
                <option value="featured">Featured</option>
                <option value="notFeatured">Not featured</option>
              </select>
            </div>
          </div>
          <RecordsBulkBar
            noun={COMPETITION_NOUN}
            selectedCount={selectedCompetitionIds.length}
            visibleCount={competitionIds.length}
            allVisibleSelected={allOfSelected(competitionSel, competitionIds)}
            onSelectAllVisible={() => setCompetitionSel(new Set(competitionIds))}
            onClear={() => setCompetitionSel(EMPTY_SELECTION)}
            busy={bulkBusy}
            actions={competitionBulkActions}
          />
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.competitions}
            empty={!loading.competitions && filteredCompetitions.length === 0}
            emptyTitle="No competitions match your filters"
            emptyHint="Create a competition or adjust search filters."
            columns={8}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  {selectAllCell({
                    label: "Select all shown competitions",
                    selection: competitionSel,
                    visibleIds: competitionIds,
                    onToggle: () =>
                      setCompetitionSel((sel) => toggleAllVisible(sel, competitionIds)),
                  })}
                  <th>Name</th>
                  <th>Type</th>
                  <th>Format</th>
                  <th>Region</th>
                  <th>Teams</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompetitions.map((c) => (
                  <tr key={c.id}>
                    {selectRowCell({
                      id: c.id,
                      label: `Select ${c.name}`,
                      selection: competitionSel,
                      onToggle: (id) => setCompetitionSel((sel) => toggleSelection(sel, id)),
                    })}
                    <td>
                      <div className="admin-sb-team-cell">
                        {c.logoUrl ? (
                          <img src={c.logoUrl} alt="" className="admin-sb-team-crest" />
                        ) : (
                          <span className="admin-sb-team-crest admin-sb-team-crest--empty" aria-hidden>
                            {c.name.slice(0, 2)}
                          </span>
                        )}
                        <span>
                          {c.name}
                          <small className="muted admin-sb-code">{c.slug}</small>
                        </span>
                      </div>
                    </td>
                    <td>{c.type}</td>
                    <td>
                      <code className="admin-sb-code">{c.formatType ?? "—"}</code>
                    </td>
                    <td>{c.region ?? "—"}</td>
                    <td>{c.teamsCount}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="admin-sb-row-actions">
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => openCompetitionEditor(c)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="admin-inline-button admin-inline-button--danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${c.name}?`)) return;
                          try {
                            await adminScoreboardApi.deleteCompetition(c.id);
                            toast.success("Competition deleted");
                            void loadCompetitions();
                            void loadCompetitionOptions();
                            void refreshStats();
                          } catch (err) {
                            toast.error(formatAdminScoreboardError(err));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "teams" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters">
              <input
                type="search"
                placeholder="Search club, slug, region, competition…"
                value={teamQ}
                onChange={(e) => setTeamQ(e.target.value)}
                aria-label="Search teams"
              />
              <select
                value={teamCompId}
                onChange={(e) => setTeamCompId(e.target.value)}
                aria-label="Filter teams by competition"
              >
                <option value="">All competitions</option>
                {competitionOptions.map((competition) => (
                  <option key={competition.id} value={competition.id}>
                    {competition.name}
                  </option>
                ))}
              </select>
              <select
                value={teamGroupFilter}
                onChange={(e) => setTeamGroupFilter(e.target.value)}
                aria-label="Filter teams by group"
              >
                <option value="">All groups</option>
                {teamGroupOptions.map((group) => (
                  <option key={group} value={group}>
                    Group {group}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <RecordsBulkBar
            noun={TEAM_NOUN}
            selectedCount={selectedTeamIds.length}
            visibleCount={teamIds.length}
            allVisibleSelected={allOfSelected(teamSel, teamIds)}
            onSelectAllVisible={() => setTeamSel(new Set(teamIds))}
            onClear={() => setTeamSel(EMPTY_SELECTION)}
            busy={bulkBusy}
            actions={teamBulkActions}
          />
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.teams}
            empty={!loading.teams && filteredTeams.length === 0}
            emptyTitle="No teams found"
            columns={6}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  {selectAllCell({
                    label: "Select all shown teams",
                    selection: teamSel,
                    visibleIds: teamIds,
                    onToggle: () => setTeamSel((sel) => toggleAllVisible(sel, teamIds)),
                  })}
                  <th>Club</th>
                  <th>Competition</th>
                  <th>Region</th>
                  <th>Squad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((t) => (
                  <tr key={t.id}>
                    {selectRowCell({
                      id: t.id,
                      label: `Select ${t.name}`,
                      selection: teamSel,
                      onToggle: (id) => setTeamSel((sel) => toggleSelection(sel, id)),
                    })}
                    <td>
                      <div className="admin-sb-team-cell">
                        {t.logoUrl ? (
                          <img src={t.logoUrl} alt="" className="admin-sb-team-crest" />
                        ) : (
                          <span className="admin-sb-team-crest admin-sb-team-crest--empty" aria-hidden>
                            {t.shortName?.slice(0, 2) ?? t.name.slice(0, 2)}
                          </span>
                        )}
                        <span>
                          {t.name}
                          <small className="muted admin-sb-code">{t.slug}</small>
                        </span>
                      </div>
                    </td>
                    <td>{t.competition.name}</td>
                    <td>{t.region ?? "—"}</td>
                    <td>{t.squadCount}</td>
                    <td className="admin-sb-row-actions">
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => {
                          setEditingTeam(t);
                          setTeamModal("edit");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => openTeamMerge(t)}
                        title="Merge this team into another, or link it to the same club in another competition"
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        className="admin-inline-button admin-inline-button--danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${t.name}?`)) return;
                          try {
                            await adminScoreboardApi.deleteTeam(t.id);
                            toast.success("Team deleted");
                            void loadTeams();
                            if (optionsLoadedRef.current.teams) void loadTeamOptions();
                            void refreshStats();
                          } catch (err) {
                            toast.error(formatAdminScoreboardError(err));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "fixtures" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters admin-filters--with-action">
              <select
                value={fixtureCompId}
                onChange={(e) => setFixtureCompId(e.target.value)}
                aria-label="Filter fixtures by competition"
              >
                <option value="">All competitions</option>
                {competitionOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="search"
                placeholder="Search fixture, venue, round..."
                value={fixtureQ}
                onChange={(e) => setFixtureQ(e.target.value)}
                aria-label="Search fixtures"
              />
              <select
                value={fixtureStatusFilter}
                onChange={(e) => setFixtureStatusFilter(e.target.value)}
                aria-label="Filter fixtures by status"
              >
                <option value="">All statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="live">Live</option>
                <option value="halftime">Halftime</option>
                <option value="finished">Finished</option>
                <option value="postponed">Postponed</option>
              </select>
            </div>
          </div>
          <RecordsBulkBar
            noun={FIXTURE_NOUN}
            selectedCount={selectedFixtureIds.length}
            visibleCount={fixtureIds.length}
            allVisibleSelected={allOfSelected(fixtureSel, fixtureIds)}
            onSelectAllVisible={() => setFixtureSel(new Set(fixtureIds))}
            onClear={() => setFixtureSel(EMPTY_SELECTION)}
            busy={bulkBusy}
            actions={fixtureBulkActions}
          />
          <div className="admin-sb-content-panel">
            <AdminSbTableShell
              loading={loading.fixtures}
              empty={!loading.fixtures && filteredFixtures.length === 0}
              emptyTitle="No fixtures yet"
              emptyHint="Create a fixture for teams in an existing competition."
              columns={8}
            >
              <table className="admin-table admin-sb-table">
                <thead>
                  <tr>
                    {selectAllCell({
                      label: "Select all shown fixtures",
                      selection: fixtureSel,
                      visibleIds: fixtureIds,
                      onToggle: () => setFixtureSel((sel) => toggleAllVisible(sel, fixtureIds)),
                    })}
                    <th>Fixture</th>
                    <th>Competition</th>
                    <th>Kickoff (WAT)</th>
                    <th>Venue</th>
                    <th>Round</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFixtures.map((m) => (
                    <tr key={m.id}>
                      {selectRowCell({
                        id: m.id,
                        label: `Select ${m.homeTeam.name} vs ${m.awayTeam.name}`,
                        selection: fixtureSel,
                        onToggle: (id) => setFixtureSel((sel) => toggleSelection(sel, id)),
                      })}
                      <td>
                        {m.homeTeam.name} vs {m.awayTeam.name}
                        <small className="muted admin-sb-code">{m.slug}</small>
                      </td>
                      <td>{m.competition.name}</td>
                      <td>{formatKickoffWat(m.kickoffAt)}</td>
                      <td>{m.venue?.trim() ? m.venue : "—"}</td>
                      <td>{m.roundLabel ?? m.stageKey ?? "—"}</td>
                      <td>
                        <span className={`admin-sb-status admin-sb-status--${m.status === "live" ? "live" : m.status === "finished" ? "finished" : "upcoming"}`}>
                          {m.status}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-inline-button"
                          onClick={() => openFixtureEditor(m)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-inline-button admin-inline-button--danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${m.homeTeam.name} vs ${m.awayTeam.name}?`)) {
                              return;
                            }
                            try {
                              await adminScoreboardApi.deleteMatch(m.id);
                              toast.success("Fixture deleted");
                              void loadFixtures();
                              void refreshStats();
                            } catch (err) {
                              toast.error(formatAdminScoreboardError(err));
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "players" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters">
              <input
                type="search"
                placeholder="Search player, club or competition…"
                value={playerQ}
                onChange={(e) => setPlayerQ(e.target.value)}
                aria-label="Search players"
              />
              <select
                value={playerTeamFilter}
                onChange={(e) => setPlayerTeamFilter(e.target.value)}
                aria-label="Filter players by team"
              >
                <option value="">All teams</option>
                {playerTeamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} · {team.competition.name}
                  </option>
                ))}
              </select>
              <select
                value={playerPositionFilter}
                onChange={(e) => setPlayerPositionFilter(e.target.value)}
                aria-label="Filter players by position group"
              >
                <option value="">All positions</option>
                {POSITION_TAGS.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
              <select
                value={playerLinkFilter}
                onChange={(e) => setPlayerLinkFilter(e.target.value)}
                aria-label="Filter players by profile link"
              >
                <option value="">Any profile link</option>
                <option value="linked">Linked profile</option>
                <option value="unlinked">No profile link</option>
              </select>
            </div>
          </div>
          <RecordsBulkBar
            noun={SQUAD_NOUN}
            selectedCount={selectedPlayerSquadIds.length}
            visibleCount={playerSquadIds.length}
            allVisibleSelected={allOfSelected(playerSel, playerSquadIds)}
            onSelectAllVisible={() => setPlayerSel(new Set(playerSquadIds))}
            onClear={() => setPlayerSel(EMPTY_SELECTION)}
            busy={bulkBusy}
            actions={squadBulkActions(selectedPlayerSquadIds, setPlayerSel)}
          />
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.players}
            empty={!loading.players && filteredPlayers.length === 0}
            emptyTitle="No players in directory"
            emptyHint="Import squad CSV per team or link players when saving rosters."
            columns={6}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
                  {selectAllCell({
                    label: "Select all shown squad rows",
                    selection: playerSel,
                    visibleIds: playerSquadIds,
                    onToggle: () => setPlayerSel((sel) => toggleAllVisible(sel, playerSquadIds)),
                  })}
                  <th>Player</th>
                  <th>#</th>
                  <th>Position</th>
                  <th>Clubs</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((p) => (
                  <tr key={p.teams[0]?.squadId ?? p.playerId ?? p.slug ?? p.displayName}>
                    {selectRowCell({
                      id: squadIdOf(p),
                      label: `Select ${p.displayName}`,
                      selection: playerSel,
                      onToggle: (id) => setPlayerSel((sel) => toggleSelection(sel, id)),
                    })}
                    <td>{p.displayName}</td>
                    <td>{p.teams[0]?.shirtNumber ?? "-"}</td>
                    <td>{p.teams[0]?.position ?? p.positionPrimary ?? "-"}</td>
                    <td className="admin-sb-clubs-cell">
                      {p.teams
                        .map((t) => `${t.teamName} (${t.competitionName})`)
                        .join(", ")}
                    </td>
                    <td className="admin-sb-row-actions">
                      <Link to={playerPath(p.slug, p.displayName)} className="text-link">
                        Profile
                      </Link>
                      {p.teams[0] && (
                        <>
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => openSquadEditor(p)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => openPlayerMerge(p)}
                            disabled={!p.playerId}
                            title={
                              p.playerId
                                ? "Merge this profile into another player"
                                : "Edit this row first to link it to a player profile"
                            }
                          >
                            Merge
                          </button>
                          <button
                            type="button"
                            className="admin-inline-button admin-inline-button--danger"
                            onClick={async () => {
                              const squadId = p.teams[0]?.squadId;
                              if (
                                !squadId ||
                                !window.confirm(`Delete ${p.displayName} from scoreboard squads?`)
                              ) {
                                return;
                              }
                              try {
                                await adminScoreboardApi.deleteSquadRow(squadId);
                                toast.success("Scoreboard player removed");
                                void loadPlayers();
                                void refreshStats();
                              } catch (err) {
                                toast.error(formatAdminScoreboardError(err));
                              }
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "nameQa" && (
        <>
          <div className="admin-sb-sticky-bar">
            <div className="admin-filters">
              <input
                type="search"
                placeholder="Search names to review..."
                value={playerQ}
                onChange={(e) => setPlayerQ(e.target.value)}
                aria-label="Search names to review"
              />
              <select
                value={nameQaFlagFilter}
                onChange={(e) => setNameQaFlagFilter(e.target.value)}
                aria-label="Filter name QA by issue type"
              >
                <option value="">All issue types</option>
                {nameQaFlagOptions.map((flag) => (
                  <option key={flag} value={flag}>
                    {flag}
                  </option>
                ))}
              </select>
              <select
                value={playerTeamFilter}
                onChange={(e) => setPlayerTeamFilter(e.target.value)}
                aria-label="Filter name QA by team"
              >
                <option value="">All teams</option>
                {playerTeamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} · {team.competition.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <RecordsBulkBar
            noun={SQUAD_NOUN}
            selectedCount={selectedNameQaSquadIds.length}
            visibleCount={nameQaSquadIds.length}
            allVisibleSelected={allOfSelected(nameQaSel, nameQaSquadIds)}
            onSelectAllVisible={() => setNameQaSel(new Set(nameQaSquadIds))}
            onClear={() => setNameQaSel(EMPTY_SELECTION)}
            busy={bulkBusy}
            actions={squadBulkActions(selectedNameQaSquadIds, setNameQaSel)}
          />
          <div className="admin-sb-content-panel">
            <AdminSbTableShell
              loading={loading.players}
              empty={!loading.players && filteredNameQaRows.length === 0}
              emptyTitle="No name issues found"
              emptyHint="Single names, duplicate normalized names, reversed names, close spelling concerns, and unusual entries appear here."
              columns={6}
            >
              <table className="admin-table admin-sb-table">
                <thead>
                  <tr>
                    {selectAllCell({
                      label: "Select all shown name reviews",
                      selection: nameQaSel,
                      visibleIds: nameQaSquadIds,
                      onToggle: () => setNameQaSel((sel) => toggleAllVisible(sel, nameQaSquadIds)),
                    })}
                    <th>Player name</th>
                    <th>Review flags</th>
                    <th>Club context</th>
                    <th>Suggested action</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNameQaRows.map(({ player, flags }) => (
                    <tr key={`name-qa-${player.teams[0]?.squadId ?? player.playerId ?? player.displayName}`}>
                      {selectRowCell({
                        id: squadIdOf(player),
                        label: `Select ${player.displayName}`,
                        selection: nameQaSel,
                        onToggle: (id) => setNameQaSel((sel) => toggleSelection(sel, id)),
                      })}
                      <td>{player.displayName}</td>
                      <td>
                        <div className="admin-sb-name-flags">
                          {flags.map((flag) => (
                            <span key={flag} className="admin-sb-status admin-sb-status--upcoming">
                              {flag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="admin-sb-clubs-cell">
                        {player.teams
                          .map((team) => `${team.teamName} (${team.competitionName})`)
                          .join(", ") || "-"}
                      </td>
                      <td className="muted">
                        Complete first and last name, normalize spelling, then merge or delete
                        duplicate squad rows where needed.
                      </td>
                      <td className="admin-sb-row-actions">
                        {player.teams[0] && (
                          <>
                            <button
                              type="button"
                              className="admin-inline-button"
                              onClick={() => openSquadEditor(player)}
                            >
                              Edit name
                            </button>
                            <button
                              type="button"
                              className="admin-inline-button"
                              onClick={() => openPlayerMerge(player)}
                              disabled={!player.playerId}
                              title={
                                player.playerId
                                  ? "Merge this profile into another player"
                                  : "Edit name first to link this row to a player profile"
                              }
                            >
                              Merge
                            </button>
                            <button
                              type="button"
                              className="admin-inline-button admin-inline-button--danger"
                              onClick={async () => {
                                const squadId = player.teams[0]?.squadId;
                                if (
                                  !squadId ||
                                  !window.confirm(`Delete ${player.displayName} from scoreboard squads?`)
                                ) {
                                  return;
                                }
                                try {
                                  await adminScoreboardApi.deleteSquadRow(squadId);
                                  toast.success("Scoreboard player removed");
                                  void loadPlayers();
                                  void refreshStats();
                                } catch (err) {
                                  toast.error(formatAdminScoreboardError(err));
                                }
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {player.slug && (
                          <Link to={playerPath(player.slug, player.displayName)} className="text-link">
                            Profile
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminSbTableShell>
          </div>
        </>
      )}

      {tab === "seeders" && (
        <div className="admin-sb-seed-grid">
          <label className="admin-sb-field admin-sb-panel">
            <span>Target competition</span>
            <select
              value={seedCompId}
              onChange={(e) => setSeedCompId(e.target.value)}
              disabled={loading.seeders}
            >
              <option value="">Select competition...</option>
              {picker.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <small className="muted">
              Used for team imports and full squad directory exports.
            </small>
          </label>
          <CsvDropzone
            label="Competitions"
            hint='Headers: name, type, region, status, isFeatured'
            templateCsv={COMPETITION_CSV_TEMPLATE}
            templateFileName="competition-seed-template.csv"
            onExport={async () => (await adminScoreboardApi.exportCompetitionsCsv()).csv}
            onImport={async (csv) => {
              try {
                const r = await adminScoreboardApi.importCompetitionsCsv(csv);
                toast.success(`Imported ${r.imported} competition(s)`);
                loadedRef.current.competitions = false;
                loadedRef.current.seeders = false;
                void loadPicker();
                void refreshStats();
              } catch (e) {
                throw new Error(formatAdminScoreboardError(e));
              }
            }}
          />
          <CsvDropzone
            label="Teams"
            disabled={!seedCompId}
            disabledReason="Select a target competition before importing teams."
            templateCsv={TEAM_CSV_TEMPLATE}
            templateFileName="team-seed-template.csv"
            hint="Headers: name, slug, region — pick competition below"
            onExport={async () =>
              (await adminScoreboardApi.exportTeamsCsv(seedCompId || undefined)).csv
            }
            onImport={async (csv) => {
              if (!seedCompId) throw new Error("Select a competition before importing teams");
              try {
                const r = await adminScoreboardApi.importTeamsCsv(csv, seedCompId);
                toast.success(`Imported ${r.imported} team(s)`);
                void refreshStats();
              } catch (e) {
                throw new Error(formatAdminScoreboardError(e));
              }
            }}
          />
          {seedCompId && (
            <div className="admin-sb-export-actions admin-sb-panel">
              <p className="muted admin-sb-export-hint">
                Export full squad directory for Calibration Engine V3
              </p>
              <button
                type="button"
                className="admin-inline-button"
                onClick={async () => {
                  const r = await adminScoreboardApi.exportCompetitionSquad(seedCompId, "json");
                  const blob = new Blob([JSON.stringify(r.rows ?? r, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `squad-${seedCompId}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("Squad directory exported (JSON)");
                }}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="admin-inline-button"
                onClick={async () => {
                  const r = await adminScoreboardApi.exportCompetitionSquad(seedCompId, "csv");
                  const blob = new Blob([r.csv ?? ""], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `squad-${seedCompId}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("Squad directory exported (CSV)");
                }}
              >
                Export CSV
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
