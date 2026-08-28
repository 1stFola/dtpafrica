import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { adminApi, type AdminPlayerRow } from "../../../../api/admin";
import { adminScoreboardApi } from "../../../../api/admin-scoreboard";
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
  positionTag,
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

  const debouncedQ = useDebouncedValue(q);
  const debouncedTeamQ = useDebouncedValue(teamQ);
  const debouncedPlayerQ = useDebouncedValue(playerQ);
  const debouncedMergeTargetQ = useDebouncedValue(mergeTargetQ);

  const loadCompetitions = useCallback(async () => {
    setLoading((s) => ({ ...s, competitions: true }));
    try {
      const rows = await adminScoreboardApi.competitions({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        q: debouncedQ || undefined,
      });
      setCompetitions(rows);
      loadedRef.current.competitions = true;
    } catch {
      setCompetitions([]);
    } finally {
      setLoading((s) => ({ ...s, competitions: false }));
    }
  }, [statusFilter, typeFilter, debouncedQ]);

  const loadTeams = useCallback(async () => {
    setLoading((s) => ({ ...s, teams: true }));
    try {
      const rows = await adminScoreboardApi.teams({
        q: debouncedTeamQ || undefined,
        competitionId: teamCompId || undefined,
      });
      setTeams(rows);
      loadedRef.current.teams = true;
    } catch {
      setTeams([]);
    } finally {
      setLoading((s) => ({ ...s, teams: false }));
    }
  }, [debouncedTeamQ, teamCompId]);

  const loadFixtures = useCallback(async () => {
    setLoading((s) => ({ ...s, fixtures: true }));
    try {
      const rows = await adminScoreboardApi.matches(fixtureCompId || undefined);
      setFixtures(sortRosterMatches(rows));
      loadedRef.current.fixtures = true;
    } catch {
      setFixtures([]);
    } finally {
      setLoading((s) => ({ ...s, fixtures: false }));
    }
  }, [fixtureCompId]);

  const loadPlayers = useCallback(async () => {
    setLoading((s) => ({ ...s, players: true }));
    try {
      const rows = await adminScoreboardApi.players(debouncedPlayerQ || undefined);
      setPlayers(rows);
      loadedRef.current.players = true;
      loadedRef.current.nameQa = true;
    } catch {
      setPlayers([]);
    } finally {
      setLoading((s) => ({ ...s, players: false }));
    }
  }, [debouncedPlayerQ]);

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
        description: "",
        isPublished: competition.isPublished,
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
    const suggestedTarget =
      players.find(
        (player) =>
          player.playerId &&
          player.playerId !== source.playerId &&
          normalizeNameKey(player.displayName) === sourceKey
      ) ??
      players.find((player) => player.playerId && player.playerId !== source.playerId);
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
        description: draft.description?.trim() || undefined,
      });
      toast.success("Competition updated");
      setEditingCompetition(null);
      loadedRef.current.competitions = false;
      void loadCompetitions();
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

  useEffect(() => {
    if (tab === "teams" || teamModal || tab === "fixtures" || fixtureOpen) {
      adminScoreboardApi.competitionPicker().then(setCompetitionOptions).catch(() => {});
    }
  }, [tab, teamModal, fixtureOpen]);

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
    if (tab !== "players" && tab !== "nameQa") return;
    adminScoreboardApi
      .teams()
      .then(setPlayerTeamOptions)
      .catch(() => setPlayerTeamOptions([]));
  }, [tab]);

  useEffect(() => {
    if (tab === "seeders" && !loadedRef.current.seeders) void loadPicker();
  }, [tab, loadPicker]);

  const playerPath = (slug: string | null, displayName: string) =>
    slug ? `/player/${slug}` : `/player/${encodeURIComponent(displayName.toLowerCase().replace(/\s+/g, "-"))}`;

  const normalizeNameKey = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const nameQaRows = useMemo(() => {
    const byName = new Map<string, AdminSbPlayerDirectoryRow[]>();
    const byFirstLast = new Map<string, AdminSbPlayerDirectoryRow[]>();
    const bySurname = new Map<string, AdminSbPlayerDirectoryRow[]>();
    const byReversed = new Map<string, AdminSbPlayerDirectoryRow[]>();

    for (const player of players) {
      const key = normalizeNameKey(player.displayName);
      if (!key) continue;
      byName.set(key, [...(byName.get(key) ?? []), player]);
      const parts = key.split(" ").filter(Boolean);
      const first = parts[0];
      const surname = parts.at(-1);
      if (first && surname) {
        const firstLast = `${first} ${surname}`;
        byFirstLast.set(firstLast, [...(byFirstLast.get(firstLast) ?? []), player]);
        bySurname.set(surname, [...(bySurname.get(surname) ?? []), player]);
        if (parts.length === 2 && first !== surname) {
          const reversed = `${surname} ${first}`;
          byReversed.set(reversed, [...(byReversed.get(reversed) ?? []), player]);
        }
      }
    }

    return players
      .map((player) => {
        const key = normalizeNameKey(player.displayName);
        const parts = key.split(" ").filter(Boolean);
        const first = parts[0];
        const surname = parts.at(-1);
        const firstLastKey = first && surname ? `${first} ${surname}` : "";
        const flags: string[] = [];
        if (parts.length < 2) flags.push("Name completion needed");
        if ((byName.get(key)?.length ?? 0) > 1) flags.push("Possible duplicate normalized name");
        if (firstLastKey && (byFirstLast.get(firstLastKey)?.length ?? 0) > 1) {
          flags.push("Same First Name and Last name");
        }
        if (surname && (bySurname.get(surname)?.length ?? 0) > 1) {
          flags.push("Same Surname");
        }
        if ((byReversed.get(key)?.length ?? 0) > 0) {
          flags.push("Swapped First name and last name");
        }
        if (/[^a-zA-Z\s.'-]/.test(player.displayName)) flags.push("Unusual name appearance");
        if (player.displayName.length <= 3 || parts.some((part) => part.length <= 1)) {
          flags.push("Unusual short name");
        }
        return { player, flags };
      })
      .filter((row) => row.flags.length > 0);
  }, [players]);

  const filteredCompetitions = useMemo(
    () =>
      competitions.filter((competition) => {
        if (publishedFilter === "published" && !competition.isPublished) return false;
        if (publishedFilter === "unpublished" && competition.isPublished) return false;
        if (featuredFilter === "featured" && !competition.isFeatured) return false;
        if (featuredFilter === "notFeatured" && competition.isFeatured) return false;
        return true;
      }),
    [competitions, featuredFilter, publishedFilter]
  );

  const teamGroupOptions = useMemo(
    () =>
      Array.from(new Set(teams.map((team) => team.groupKey).filter(Boolean) as string[])).sort(),
    [teams]
  );

  const filteredTeams = useMemo(
    () =>
      teams.filter((team) => {
        if (teamGroupFilter && team.groupKey !== teamGroupFilter) return false;
        return true;
      }),
    [teamGroupFilter, teams]
  );

  const fixtureSearch = fixtureQ.trim().toLowerCase();
  const filteredFixtures = useMemo(
    () =>
      fixtures.filter((match) => {
        if (fixtureStatusFilter && match.status !== fixtureStatusFilter) return false;
        if (!fixtureSearch) return true;
        const haystack = [
          match.homeTeam.name,
          match.awayTeam.name,
          match.competition.name,
          match.slug,
          match.venue,
          match.roundLabel,
          match.stageKey,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(fixtureSearch);
      }),
    [fixtureSearch, fixtureStatusFilter, fixtures]
  );

  const filteredPlayers = useMemo(
    () =>
      players.filter((player) => {
        if (playerTeamFilter && !player.teams.some((team) => team.teamId === playerTeamFilter)) {
          return false;
        }
        if (
          playerPositionFilter &&
          !player.teams.some(
            (team) => positionTag(team.position ?? player.positionPrimary) === playerPositionFilter
          )
        ) {
          return false;
        }
        if (playerLinkFilter === "linked" && !player.playerId) return false;
        if (playerLinkFilter === "unlinked" && player.playerId) return false;
        return true;
      }),
    [playerLinkFilter, playerPositionFilter, playerTeamFilter, players]
  );

  const filteredNameQaRows = useMemo(
    () =>
      nameQaRows.filter(({ flags, player }) => {
        if (nameQaFlagFilter && !flags.includes(nameQaFlagFilter)) return false;
        if (playerTeamFilter && !player.teams.some((team) => team.teamId === playerTeamFilter)) {
          return false;
        }
        return true;
      }),
    [nameQaFlagFilter, nameQaRows, playerTeamFilter]
  );

  const nameQaFlagOptions = useMemo(
    () => Array.from(new Set(nameQaRows.flatMap((row) => row.flags))).sort(),
    [nameQaRows]
  );

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
                  value={editingCompetition.draft.status ?? "upcoming"}
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
                      {status === "active"
                        ? "Ongoing"
                        : status.charAt(0).toUpperCase() + status.slice(1)}
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
              <label className="admin-sb-field">
                <span>Find canonical target profile</span>
                <input
                  type="search"
                  value={mergeTargetQ}
                  onChange={(e) => setMergeTargetQ(e.target.value)}
                  placeholder="Search all master players, including profiles with no ScoreBoard history"
                  disabled={mergeSaving}
                />
                <small className="muted">
                  This searches the full `/admin/players` database, so the target can have no
                  ScoreBoard events yet and can use a different listed position.
                </small>
              </label>
              <label className="admin-sb-field">
                <span>Canonical target profile</span>
                <select
                  value={mergingPlayers.targetPlayerId}
                  onChange={(e) =>
                    setMergingPlayers((current) =>
                      current ? { ...current, targetPlayerId: e.target.value } : current
                    )
                  }
                  required
                >
                  <option value="">Select the profile to keep...</option>
                  {mergeTargetOptions.map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {player.displayName}
                      {player.positionPrimary ? ` (${player.positionPrimary})` : ""}
                      {` - ${player.context}`}
                      {player.source === "players" ? " - no ScoreBoard link required" : ""}
                    </option>
                  ))}
                </select>
                {mergeTargetsLoading ? (
                  <small className="muted">Searching master player profiles...</small>
                ) : mergeTargetOptions.length === 0 ? (
                  <small className="muted">No merge target found. Try a broader name search.</small>
                ) : null}
              </label>
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
                placeholder="Search name, slug, region…"
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
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.competitions}
            empty={!loading.competitions && filteredCompetitions.length === 0}
            emptyTitle="No competitions match your filters"
            emptyHint="Create a competition or adjust search filters."
            columns={7}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
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
                    <td>{c.name}</td>
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
                placeholder="Search clubs…"
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
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.teams}
            empty={!loading.teams && filteredTeams.length === 0}
            emptyTitle="No teams found"
            columns={5}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
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
                        className="admin-inline-button admin-inline-button--danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${t.name}?`)) return;
                          try {
                            await adminScoreboardApi.deleteTeam(t.id);
                            toast.success("Team deleted");
                            void loadTeams();
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
          <div className="admin-sb-content-panel">
            <AdminSbTableShell
              loading={loading.fixtures}
              empty={!loading.fixtures && filteredFixtures.length === 0}
              emptyTitle="No fixtures yet"
              emptyHint="Create a fixture for teams in an existing competition."
              columns={7}
            >
              <table className="admin-table admin-sb-table">
                <thead>
                  <tr>
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
                placeholder="Search players in scoreboard squads…"
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
          <div className="admin-sb-content-panel">
          <AdminSbTableShell
            loading={loading.players}
            empty={!loading.players && filteredPlayers.length === 0}
            emptyTitle="No players in directory"
            emptyHint="Import squad CSV per team or link players when saving rosters."
            columns={5}
          >
            <table className="admin-table admin-sb-table">
              <thead>
                <tr>
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
          <div className="admin-sb-content-panel">
            <AdminSbTableShell
              loading={loading.players}
              empty={!loading.players && filteredNameQaRows.length === 0}
              emptyTitle="No name issues found"
              emptyHint="Single names, duplicate normalized names, reversed names, close spelling concerns, and unusual entries appear here."
              columns={5}
            >
              <table className="admin-table admin-sb-table">
                <thead>
                  <tr>
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
