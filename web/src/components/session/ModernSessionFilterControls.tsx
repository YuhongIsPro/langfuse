import { useRef, useState } from "react";
import { Check, Filter, ListFilter, Save, Settings2, X } from "lucide-react";
import {
  type ColumnDefinition,
  type FilterState,
  type TableViewPresetState,
  TableViewPresetTableName,
} from "@langfuse/shared";
import {
  type ColumnOrderState,
  type VisibilityState,
} from "@tanstack/react-table";
import isEqual from "lodash/isEqual";

import {
  combineModernSessionObservationFilters,
  splitModernSessionObservationFilters,
  type ModernSessionObservationIdentity,
} from "@/src/components/session/modernSessionObservationFilters";
import {
  SESSION_DETAIL_SYSTEM_PRESETS,
  SESSION_DETAIL_VIEW_TRIGGER_ID,
} from "@/src/components/session/session-detail-presets";
import { TableViewPresetsDrawer } from "@/src/components/table/table-view-presets/components/data-table-view-presets-drawer";
import { useViewData } from "@/src/components/table/table-view-presets/hooks/useViewData";
import { useViewMutations } from "@/src/components/table/table-view-presets/hooks/useViewMutations";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { Input } from "@/src/components/ui/input";
import { InlineFilterBuilder } from "@/src/features/filters/components/filter-builder";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { usePostHogClientCapture } from "@/src/features/posthog-analytics/usePostHogClientCapture";

type ViewControllers = {
  selectedViewId: string | null;
  appliedViewId: string | null;
  handleSetViewId: (viewId: string | null) => void;
  applyViewState: (
    viewData: TableViewPresetState,
    meta?: {
      trigger: "select" | "permalink" | "default" | "system_preset";
      viewId?: string | null;
    },
  ) => void;
};

type ModernSessionFilterControlsProps = {
  projectId: string;
  filterState: FilterState;
  filterColumns: ColumnDefinition[];
  filterColumnsWithCustomSelect: string[];
  onChange: (filters: FilterState) => void;
  viewControllers: ViewControllers;
  currentViewState: {
    orderBy: null;
    filters: FilterState;
    columnOrder: ColumnOrderState;
    columnVisibility: VisibilityState;
    searchQuery: string;
  };
};

const normalizeFilters = (filters: FilterState) =>
  filters.map((filter) =>
    Object.fromEntries(
      Object.entries(filter).filter(([, value]) => value !== undefined),
    ),
  );

export function ModernSessionFilterControls({
  projectId,
  filterState,
  filterColumns,
  filterColumnsWithCustomSelect,
  onChange,
  viewControllers,
  currentViewState,
}: ModernSessionFilterControlsProps) {
  const capture = usePostHogClientCapture();
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [manageViewsOpen, setManageViewsOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<FilterState>([]);
  const [draftExclusions, setDraftExclusions] = useState<
    ModernSessionObservationIdentity[]
  >([]);
  const [viewName, setViewName] = useState("");
  const openAfterMenuCloseRef = useRef<(() => void) | null>(null);
  const { regularFilters, exclusions } =
    splitModernSessionObservationFilters(filterState);
  const activeFilterCount = regularFilters.length + exclusions.length;
  const { TableViewPresetsList } = useViewData({
    tableName: TableViewPresetTableName.SessionDetail,
    projectId,
  });
  const hasWriteAccess = useHasProjectAccess({
    projectId,
    scope: "TableViewPresets:CUD",
  });
  const { createMutation } = useViewMutations({
    handleSetViewId: viewControllers.handleSetViewId,
    applyViewState: viewControllers.applyViewState,
  });

  const matchingSystemPreset = SESSION_DETAIL_SYSTEM_PRESETS.find(
    (preset) =>
      preset.id === viewControllers.selectedViewId &&
      isEqual(normalizeFilters(preset.filters), normalizeFilters(filterState)),
  );
  const matchingSavedView = TableViewPresetsList?.find(
    (view) =>
      view.id === viewControllers.selectedViewId &&
      isEqual(normalizeFilters(view.filters), normalizeFilters(filterState)),
  );
  const activeViewName = matchingSystemPreset?.name ?? matchingSavedView?.name;

  const openFilterDialog = () => {
    const split = splitModernSessionObservationFilters(filterState);
    setDraftFilters(split.regularFilters);
    setDraftExclusions(split.exclusions);
    setViewName("");
    setFilterDialogOpen(true);
    capture("table:filter_builder_open", {
      tableName: "session-detail",
      isV4: true,
    });
  };

  const openAfterMenuClose = (action: () => void) => {
    openAfterMenuCloseRef.current = action;
  };

  const applyFilters = () => {
    const nextFilters = combineModernSessionObservationFilters(
      draftFilters,
      draftExclusions,
    );
    if (isEqual(normalizeFilters(nextFilters), normalizeFilters(filterState))) {
      setFilterDialogOpen(false);
      return;
    }

    onChange(nextFilters);
    const appliedFilter = nextFilters[nextFilters.length - 1];
    if (appliedFilter) {
      capture("filters:applied", {
        surface: "filter_builder",
        tableName: "session-detail",
        column: appliedFilter.column,
        filterType: appliedFilter.type,
        operator: appliedFilter.operator,
        ...("key" in appliedFilter && appliedFilter.key
          ? { key: appliedFilter.key }
          : {}),
        valueCount: Array.isArray(appliedFilter.value)
          ? appliedFilter.value.length
          : 1,
        conditionCount: nextFilters.length,
        columnConditionCount: nextFilters.filter(
          (filter) => filter.column === appliedFilter.column,
        ).length,
        isV4: true,
      });
    } else if (filterState.length > 0) {
      capture("filters:cleared", {
        surface: "filter_builder",
        tableName: "session-detail",
        clearedCount: filterState.length,
        isV4: true,
      });
    }
    setFilterDialogOpen(false);
  };

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const nextFilters = combineModernSessionObservationFilters(
      draftFilters,
      draftExclusions,
    );

    capture("saved_views:create", {
      tableName: TableViewPresetTableName.SessionDetail,
    });
    createMutation.mutate({
      name,
      tableName: TableViewPresetTableName.SessionDetail,
      projectId,
      orderBy: null,
      filters: nextFilters,
      columnOrder: currentViewState.columnOrder,
      columnVisibility: currentViewState.columnVisibility,
      searchQuery: "",
    });
    setFilterDialogOpen(false);
  };

  const applyPreset = (
    preset: (typeof SESSION_DETAIL_SYSTEM_PRESETS)[number],
  ) => {
    capture("saved_views:system_preset_selected", {
      tableName: TableViewPresetTableName.SessionDetail,
      presetId: preset.id,
    });
    viewControllers.handleSetViewId(preset.id);
    viewControllers.applyViewState(
      {
        filters: preset.filters,
        columnOrder: [],
        columnVisibility: {},
        orderBy: null,
        searchQuery: "",
      },
      { trigger: "system_preset", viewId: preset.id },
    );
  };

  const applySavedView = (
    view: TableViewPresetState & { id: string; name: string },
  ) => {
    capture("saved_views:view_selected", {
      tableName: TableViewPresetTableName.SessionDetail,
      viewId: view.id,
    });
    viewControllers.handleSetViewId(view.id);
    viewControllers.applyViewState(view, {
      trigger: "select",
      viewId: view.id,
    });
  };

  const clearFilters = () => {
    onChange([]);
    viewControllers.handleSetViewId(null);
    capture("filters:cleared", {
      surface: "filter_builder",
      tableName: "session-detail",
      clearedCount: activeFilterCount,
      isV4: true,
    });
  };

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) return;
          const action = openAfterMenuCloseRef.current;
          openAfterMenuCloseRef.current = null;
          if (action) window.requestAnimationFrame(action);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            id={SESSION_DETAIL_VIEW_TRIGGER_ID}
            type="button"
            variant="outline"
            size="icon"
            className="relative h-7 w-7 shrink-0 rounded-sm"
            aria-label="Filter observations"
          >
            <ListFilter className="h-3.5 w-3.5" />
            {activeFilterCount > 0 ? (
              <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-mono text-[9px]">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Presets</DropdownMenuLabel>
          {SESSION_DETAIL_SYSTEM_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => applyPreset(preset)}
              className="items-start gap-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{preset.name}</span>
                {preset.description ? (
                  <span className="text-muted-foreground block text-xs">
                    {preset.description}
                  </span>
                ) : null}
              </span>
              {matchingSystemPreset?.id === preset.id ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Save className="mr-2 h-4 w-4" />
              Saved Views
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {TableViewPresetsList?.filter((view) => !view.isSystem).map(
                (view) => (
                  <DropdownMenuItem
                    key={view.id}
                    onSelect={() => applySavedView(view)}
                  >
                    <span className="min-w-0 flex-1 truncate" title={view.name}>
                      {view.name}
                    </span>
                    {matchingSavedView?.id === view.id ? (
                      <Check className="ml-2 h-4 w-4 shrink-0" />
                    ) : null}
                  </DropdownMenuItem>
                ),
              )}
              {!TableViewPresetsList?.some((view) => !view.isSystem) ? (
                <DropdownMenuItem disabled>No saved views</DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  openAfterMenuClose(() => setManageViewsOpen(true))
                }
              >
                <Settings2 className="mr-2 h-4 w-4" />
                Manage Views
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => openAfterMenuClose(openFilterDialog)}
          >
            <Filter className="mr-2 h-4 w-4" />
            Apply custom filter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {activeFilterCount > 0 ||
      activeViewName ||
      viewControllers.selectedViewId ? (
        <div className="text-muted-foreground flex basis-full items-center gap-2 overflow-hidden pt-1 font-mono text-[10px]">
          <span
            className="min-w-0 flex-1 truncate"
            title={activeViewName ?? `${activeFilterCount} active filters`}
          >
            {activeViewName ?? `${activeFilterCount} active filters`}
          </span>
          {!activeViewName ? (
            <button
              type="button"
              className="hover:text-foreground shrink-0"
              onClick={openFilterDialog}
            >
              Save filters as view
            </button>
          ) : null}
          <button
            type="button"
            className="hover:text-foreground shrink-0"
            onClick={openFilterDialog}
          >
            Edit
          </button>
          <button
            type="button"
            className="hover:text-foreground shrink-0"
            onClick={clearFilters}
          >
            Clear
          </button>
        </div>
      ) : null}

      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Filter observations</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-5 overflow-y-auto">
            <div className="space-y-2">
              <label
                htmlFor="modern-session-view-name"
                className="text-sm font-bold"
              >
                View name{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Input
                id="modern-session-view-name"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
                placeholder="Name this filter view"
              />
            </div>
            <InlineFilterBuilder
              columns={filterColumns}
              filterState={draftFilters}
              onChange={setDraftFilters}
              columnsWithCustomSelect={filterColumnsWithCustomSelect}
            />
            {draftExclusions.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-bold">Excluded observations</h3>
                <div className="flex flex-wrap gap-2">
                  {draftExclusions.map((exclusion) => {
                    const key = `${exclusion.type}:${exclusion.name}`;
                    return (
                      <span
                        key={key}
                        className="bg-muted flex items-center gap-1 rounded-sm px-2 py-1 text-xs"
                      >
                        {exclusion.type}: {exclusion.name}
                        <button
                          type="button"
                          aria-label={`Remove ${exclusion.type} ${exclusion.name} exclusion`}
                          onClick={() =>
                            setDraftExclusions((current) =>
                              current.filter(
                                (item) =>
                                  item.type !== exclusion.type ||
                                  item.name !== exclusion.name,
                              ),
                            )
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFilterDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={saveView}
              disabled={
                !viewName.trim() || !hasWriteAccess || createMutation.isPending
              }
            >
              Save as view
            </Button>
            <Button onClick={applyFilters}>Apply filters</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TableViewPresetsDrawer
        open={manageViewsOpen}
        onOpenChange={setManageViewsOpen}
        hideTrigger
        viewConfig={{
          tableName: TableViewPresetTableName.SessionDetail,
          projectId,
          controllers: viewControllers,
        }}
        currentState={currentViewState}
        systemFilterPresets={SESSION_DETAIL_SYSTEM_PRESETS}
      />
    </>
  );
}
