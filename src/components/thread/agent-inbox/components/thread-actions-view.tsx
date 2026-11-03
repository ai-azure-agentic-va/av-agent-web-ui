import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Interrupt } from "@langchain/langgraph-sdk";
import { Button } from "@/components/ui/button";
import {
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThreadIdCopyable } from "./thread-id";
import { InboxItemInput } from "./inbox-item-input";
import useInterruptedActions from "../hooks/use-interrupted-actions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryState } from "nuqs";
import { constructOpenInStudioURL, buildDecisionFromState } from "../utils";
import { Decision, HITLRequest, DecisionType, ActionRequest } from "../types";
import { useStreamContext } from "@/providers/Stream";

interface ThreadActionsViewProps {
  interrupt: Interrupt<HITLRequest>;
  handleShowSidePanel: (showState: boolean, showDescription: boolean) => void;
  showState: boolean;
  showDescription: boolean;
  /** Picks between several pending interrupts; heads the card body. */
  switcher?: ReactNode;
}

function ButtonGroup({
  handleShowState,
  handleShowDescription,
  showingState,
  showingDescription,
}: {
  handleShowState: () => void;
  handleShowDescription: () => void;
  showingState: boolean;
  showingDescription: boolean;
}) {
  return (
    <div className="flex flex-row items-center justify-center gap-0">
      <Button
        variant="outline"
        className={cn(
          "rounded-l-md rounded-r-none border-r-[0px]",
          showingState ? "text-foreground" : "bg-background",
        )}
        size="sm"
        onClick={handleShowState}
      >
        State
      </Button>
      <Button
        variant="outline"
        className={cn(
          "rounded-l-none rounded-r-md border-l-[0px]",
          showingDescription ? "text-foreground" : "bg-background",
        )}
        size="sm"
        onClick={handleShowDescription}
      >
        Description
      </Button>
    </div>
  );
}

function isValidHitlRequest(
  interrupt: Interrupt<HITLRequest>,
): interrupt is Interrupt<HITLRequest> & { value: HITLRequest } {
  return (
    !!interrupt.value &&
    Array.isArray(interrupt.value.action_requests) &&
    interrupt.value.action_requests.length > 0 &&
    Array.isArray(interrupt.value.review_configs) &&
    interrupt.value.review_configs.length > 0
  );
}

function getDecisionStatus(
  decision: Decision | undefined,
): DecisionType | null {
  if (!decision) return null;
  return decision.type;
}

const STATUS_LABEL: Record<DecisionType, string> = {
  approve: "approved",
  edit: "edited",
  reject: "rejected",
};

function getActionTitle(action?: ActionRequest) {
  return action?.name ?? "Unknown interrupt";
}

export function ThreadActionsView({
  interrupt,
  handleShowSidePanel,
  showDescription,
  showState,
  switcher,
}: ThreadActionsViewProps) {
  const stream = useStreamContext();
  const [threadId] = useQueryState("threadId");
  const [apiUrl] = useQueryState("apiUrl");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [addressedActions, setAddressedActions] = useState<
    Map<number, Decision>
  >(new Map());
  const [submittingAll, setSubmittingAll] = useState(false);

  const hitlValue = interrupt.value;
  const actionRequests = useMemo(
    () => hitlValue?.action_requests ?? [],
    [hitlValue?.action_requests],
  );
  const reviewConfigs = useMemo(
    () => hitlValue?.review_configs ?? [],
    [hitlValue?.review_configs],
  );

  const hasMultipleActions = actionRequests.length > 1;
  const currentAction = actionRequests[currentIndex];
  const matchingConfig =
    reviewConfigs.find(
      (config) => config.action_name === currentAction?.name,
    ) ?? reviewConfigs[currentIndex];

  const singleActionInterrupt = useMemo(() => {
    if (!currentAction || !matchingConfig) {
      return interrupt;
    }

    return {
      ...interrupt,
      value: {
        action_requests: [currentAction],
        review_configs: [matchingConfig],
      },
    };
  }, [interrupt, currentAction, matchingConfig]);

  const {
    approveAllowed,
    hasEdited,
    hasAddedResponse,
    streaming,
    supportsMultipleMethods,
    streamFinished,
    loading,
    handleSubmit,
    handleResolve,
    setSelectedSubmitType,
    setHasAddedResponse,
    setHasEdited,
    humanResponse,
    setHumanResponse,
    selectedSubmitType,
    initialHumanInterruptEditValue,
  } = useInterruptedActions({
    interrupt: singleActionInterrupt,
  });

  useEffect(() => {
    setCurrentIndex(0);
    setAddressedActions(new Map());
  }, [interrupt]);

  const handleOpenInStudio = () => {
    if (!apiUrl) {
      toast.error("Error", {
        description: "Please set the LangGraph deployment URL in settings.",
        duration: 5000,
        richColors: true,
        closeButton: true,
      });
      return;
    }

    const studioUrl = constructOpenInStudioURL(apiUrl, threadId ?? undefined);
    window.open(studioUrl, "_blank");
  };

  const handleApproveAll = useCallback(() => {
    if (!hasMultipleActions) return;

    try {
      const allDecisions: Decision[] = actionRequests.map(() => ({
        type: "approve",
      }));

      stream.submit(
        {},
        {
          command: {
            resume: { decisions: allDecisions },
          },
        },
      );

      toast("Success", {
        description: "All actions approved successfully.",
        duration: 5000,
      });
    } catch (error) {
      console.error("Error approving all actions", error);
      toast.error("Error", {
        description: "Failed to approve all actions.",
        richColors: true,
        closeButton: true,
        duration: 5000,
      });
    }
  }, [actionRequests, hasMultipleActions, stream]);

  const handleSubmitAll = useCallback(() => {
    if (!hasMultipleActions) return;

    if (addressedActions.size !== actionRequests.length) {
      toast.error("Error", {
        description: `Please address all ${actionRequests.length} actions before submitting.`,
        richColors: true,
        closeButton: true,
        duration: 5000,
      });
      return;
    }

    try {
      setSubmittingAll(true);
      const allDecisions = actionRequests.map((_, index) => {
        const decision = addressedActions.get(index);
        if (!decision) {
          throw new Error(`Missing decision for action ${index + 1}`);
        }
        return decision;
      });

      stream.submit(
        {},
        {
          command: {
            resume: { decisions: allDecisions },
          },
        },
      );

      toast("Success", {
        description: "All actions submitted successfully.",
        duration: 5000,
      });
      setAddressedActions(new Map());
    } catch (error) {
      console.error("Error submitting all actions", error);
      toast.error("Error", {
        description: "Failed to submit actions.",
        richColors: true,
        closeButton: true,
        duration: 5000,
      });
    } finally {
      setSubmittingAll(false);
    }
  }, [actionRequests, addressedActions, hasMultipleActions, stream]);

  const allAllowApprove = useMemo(() => {
    if (!hasMultipleActions) return false;
    return actionRequests.every((actionRequest) => {
      const matching = reviewConfigs.find(
        (config) => config.action_name === actionRequest.name,
      );
      return matching?.allowed_decisions.includes("approve");
    });
  }, [actionRequests, reviewConfigs, hasMultipleActions]);

  const handleSaveDecision = () => {
    const { decision, error } = buildDecisionFromState(
      humanResponse,
      selectedSubmitType,
    );

    if (!decision || error) {
      toast.error("Error", {
        description: error ?? "Unable to determine decision.",
        richColors: true,
        closeButton: true,
        duration: 5000,
      });
      return;
    }

    setAddressedActions((prev) => {
      const next = new Map(prev);
      next.set(currentIndex, decision);
      return next;
    });

    toast("Success", {
      description: `Action ${currentIndex + 1} captured.`,
      duration: 3000,
    });

    if (currentIndex < actionRequests.length - 1) {
      setCurrentIndex((prev) => Math.min(actionRequests.length - 1, prev + 1));
    }
  };

  const currentTitle = getActionTitle(currentAction);
  const actionsDisabled = loading || streaming || submittingAll;
  const hasAllDecisions =
    hasMultipleActions && addressedActions.size === actionRequests.length;

  if (!isValidHitlRequest(interrupt)) {
    return (
      <CardBody>
        <p className="text-muted-foreground text-sm">
          Unable to render interrupt. The data provided is not in the expected
          HITL format.
        </p>
      </CardBody>
    );
  }
  const interruptValue = singleActionInterrupt.value as HITLRequest;

  return (
    <>
      <CardHeader className="flex-wrap gap-y-1">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <CardTitle
            as="h2"
            className="min-w-0 text-pretty"
          >
            {hasMultipleActions
              ? `${currentTitle} (${currentIndex + 1}/${actionRequests.length})`
              : currentTitle}
          </CardTitle>
          {threadId && <ThreadIdCopyable threadId={threadId} />}
        </div>
        <div className="flex flex-row items-center justify-start gap-2">
          {apiUrl && (
            <Button
              size="sm"
              variant="outline"
              className="bg-background flex items-center gap-1"
              onClick={handleOpenInStudio}
            >
              Studio
            </Button>
          )}
          <ButtonGroup
            handleShowState={() => handleShowSidePanel(true, false)}
            handleShowDescription={() => handleShowSidePanel(false, true)}
            showingState={showState}
            showingDescription={showDescription}
          />
        </div>
      </CardHeader>

      <CardBody className="flex w-full max-w-full flex-col gap-5">
        {switcher}

        <div className="flex w-full flex-row flex-wrap items-center justify-start gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResolve}
            disabled={actionsDisabled}
          >
            Mark as resolved
          </Button>
          {hasMultipleActions && allAllowApprove && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleApproveAll}
              disabled={actionsDisabled}
            >
              Approve all
            </Button>
          )}
        </div>

        {hasMultipleActions && (
          <div className="flex w-full items-center gap-2">
            {actionRequests.map((_, index) => {
              const status = getDecisionStatus(addressedActions.get(index));
              const label = `Action ${index + 1}${status ? `: ${STATUS_LABEL[status]}` : ""}`;
              return (
                <button
                  type="button"
                  key={index}
                  onClick={() => setCurrentIndex(index)}
                  title={label}
                  className={cn(
                    "focus-visible:ring-ring h-2 flex-1 rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                    "border-border bg-border",
                    // No green or amber in the palette: approved is black, edited
                    // is a black outline, rejected takes the red tint.
                    status === "approve" && "border-foreground bg-foreground",
                    status === "edit" && "border-foreground bg-background",
                    status === "reject" && "border-signal-ink bg-signal-tint",
                    index === currentIndex &&
                      "outline-foreground outline-2 outline-offset-2",
                  )}
                >
                  <span className="sr-only">{label}</span>
                </button>
              );
            })}
          </div>
        )}

        <InboxItemInput
          approveAllowed={approveAllowed}
          hasEdited={hasEdited}
          hasAddedResponse={hasAddedResponse}
          interruptValue={interruptValue}
          humanResponse={humanResponse}
          initialValues={initialHumanInterruptEditValue.current}
          setHumanResponse={setHumanResponse}
          supportsMultipleMethods={supportsMultipleMethods}
          setSelectedSubmitType={setSelectedSubmitType}
          setHasAddedResponse={setHasAddedResponse}
          setHasEdited={setHasEdited}
          handleSubmit={hasMultipleActions ? handleSaveDecision : handleSubmit}
          isLoading={hasMultipleActions ? submittingAll : loading}
          selectedSubmitType={selectedSubmitType}
        />

        {!hasMultipleActions && streamFinished && (
          <p className="text-foreground text-sm font-medium">
            Successfully finished Graph invocation.
          </p>
        )}
      </CardBody>

      {hasMultipleActions && (
        <CardFooter className="justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentIndex === actionRequests.length - 1}
              onClick={() =>
                setCurrentIndex((prev) =>
                  Math.min(actionRequests.length - 1, prev + 1),
                )
              }
            >
              Next
            </Button>
          </div>
          <Button
            variant="default"
            disabled={!hasAllDecisions || submittingAll}
            onClick={handleSubmitAll}
          >
            {submittingAll
              ? "Submitting..."
              : `Submit all ${actionRequests.length} decisions`}
          </Button>
        </CardFooter>
      )}
    </>
  );
}
