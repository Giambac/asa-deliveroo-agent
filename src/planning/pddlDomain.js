/**
 * STRIPS domain for Deliveroo navigation and single-parcel delivery,
 * aligned with the course reference domain (lab5 `domain-deliveroo.pddl`).
 * The runtime still uses PDDL mainly as a `go_to` plan, but the same
 * domain can now express a full collect-and-deliver subproblem for
 * experiments and report comparisons.
 *
 * Edge predicates are emitted only where movement is allowed, so one-way
 * arrow tiles are encoded for free: a forbidden entry simply has no edge.
 *
 * A separate crate-aware domain (`DELIVEROO_CRATES_DOMAIN`) adds Sokoban
 * push actions for the practice maps. It is used only behind the
 * `PDDL_CRATES_ENABLED` gate (experiments/report); the deterministic BDI
 * push is the reliable runtime path.
 */

export const DOMAIN_NAME = 'deliveroo-asa';

export const DELIVEROO_DOMAIN = `
(define (domain ${DOMAIN_NAME})
  (:requirements :strips)
  (:predicates
    (at ?t)            ; the agent stands on tile ?t
    (parcel ?p)        ; ?p is a parcel object
    (parcel-at ?p ?t)  ; parcel ?p is free on tile ?t
    (carrying ?p)      ; the agent carries parcel ?p
    (delivery ?t)      ; tile ?t accepts deliveries
    (delivered ?p)     ; parcel ?p was delivered
    (up ?from ?to)     ; ?to is one step up from ?from and entry is allowed
    (down ?from ?to)
    (left ?from ?to)
    (right ?from ?to)
  )
  (:action move-up
    :parameters (?from ?to)
    :precondition (and (at ?from) (up ?from ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action move-down
    :parameters (?from ?to)
    :precondition (and (at ?from) (down ?from ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action move-left
    :parameters (?from ?to)
    :precondition (and (at ?from) (left ?from ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action move-right
    :parameters (?from ?to)
    :precondition (and (at ?from) (right ?from ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action pickup
    :parameters (?p ?t)
    :precondition (and (parcel ?p) (at ?t) (parcel-at ?p ?t))
    :effect (and (not (parcel-at ?p ?t)) (carrying ?p))
  )
  (:action putdown
    :parameters (?p ?t)
    :precondition (and (parcel ?p) (at ?t) (delivery ?t) (carrying ?p))
    :effect (and (not (carrying ?p)) (delivered ?p))
  )
)
`.trim();

/** Map solved plan action names back to game move directions. */
export const ACTION_TO_DIRECTION = {
  'move-up': 'up',
  'move-down': 'down',
  'move-left': 'left',
  'move-right': 'right',
};

export const CRATES_DOMAIN_NAME = 'deliveroo-asa-crates';

/**
 * Crate-aware (Sokoban) domain: the movement domain plus push actions.
 *
 *  - (crate ?c)        ?c is a pushable crate object;
 *  - (crate-at ?c ?t)  crate ?c occupies tile ?t;
 *  - (pushable ?t)     tile ?t is a type-5 yellow zone (crate-droppable);
 *  - (clear ?t)        tile ?t holds no crate (the agent may step / push onto it).
 *
 * A `push-<dir>` shoves a crate one tile: the agent on ?from pushes the
 * crate on the adjacent ?mid onto ?to (one further step in the same
 * direction), which must be a clear pushable zone — mirroring the server
 * rule. The agent ends on ?mid, the crate on ?to. Movement actions require
 * the destination clear so the agent never walks onto a crate.
 */
export const DELIVEROO_CRATES_DOMAIN = `
(define (domain ${CRATES_DOMAIN_NAME})
  (:requirements :strips)
  (:predicates
    (at ?t)            ; the agent stands on tile ?t
    (crate ?c)         ; ?c is a pushable crate object
    (crate-at ?c ?t)   ; crate ?c occupies tile ?t
    (pushable ?t)      ; tile ?t is a type-5 zone a crate can be pushed onto
    (clear ?t)         ; tile ?t holds no crate
    (up ?from ?to)     ; ?to is one step up from ?from and entry is allowed
    (down ?from ?to)
    (left ?from ?to)
    (right ?from ?to)
  )
  (:action move-up
    :parameters (?from ?to)
    :precondition (and (at ?from) (up ?from ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action move-down
    :parameters (?from ?to)
    :precondition (and (at ?from) (down ?from ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action move-left
    :parameters (?from ?to)
    :precondition (and (at ?from) (left ?from ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action move-right
    :parameters (?from ?to)
    :precondition (and (at ?from) (right ?from ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?to))
  )
  (:action push-up
    :parameters (?c ?from ?mid ?to)
    :precondition (and (crate ?c) (at ?from) (crate-at ?c ?mid)
                       (up ?from ?mid) (up ?mid ?to) (pushable ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?mid)
                 (not (crate-at ?c ?mid)) (crate-at ?c ?to)
                 (clear ?mid) (not (clear ?to)))
  )
  (:action push-down
    :parameters (?c ?from ?mid ?to)
    :precondition (and (crate ?c) (at ?from) (crate-at ?c ?mid)
                       (down ?from ?mid) (down ?mid ?to) (pushable ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?mid)
                 (not (crate-at ?c ?mid)) (crate-at ?c ?to)
                 (clear ?mid) (not (clear ?to)))
  )
  (:action push-left
    :parameters (?c ?from ?mid ?to)
    :precondition (and (crate ?c) (at ?from) (crate-at ?c ?mid)
                       (left ?from ?mid) (left ?mid ?to) (pushable ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?mid)
                 (not (crate-at ?c ?mid)) (crate-at ?c ?to)
                 (clear ?mid) (not (clear ?to)))
  )
  (:action push-right
    :parameters (?c ?from ?mid ?to)
    :precondition (and (crate ?c) (at ?from) (crate-at ?c ?mid)
                       (right ?from ?mid) (right ?mid ?to) (pushable ?to) (clear ?to))
    :effect (and (not (at ?from)) (at ?mid)
                 (not (crate-at ?c ?mid)) (crate-at ?c ?to)
                 (clear ?mid) (not (clear ?to)))
  )
)
`.trim();

/** Map solved push-action names back to game move directions. */
export const PUSH_ACTION_TO_DIRECTION = {
  'push-up': 'up',
  'push-down': 'down',
  'push-left': 'left',
  'push-right': 'right',
};
