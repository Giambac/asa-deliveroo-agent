/**
 * STRIPS domain for Deliveroo navigation, aligned with the course
 * reference domain (lab5 `domain-deliveroo.pddl`) but reduced to the
 * subproblem we actually delegate to the planner: single-agent movement
 * on the directed tile graph.
 *
 * Edge predicates are emitted only where movement is allowed, so one-way
 * arrow tiles are encoded for free: a forbidden entry simply has no edge.
 *
 * TODO(strategy): extend with pickup/putdown actions (and parcel/delivery
 * predicates) to plan full collect-and-deliver sequences, or with the
 * crate-pushing actions from `domain-deliveroojs-crates.pddl` for the
 * Sokoban-style practice maps.
 */

export const DOMAIN_NAME = 'deliveroo-asa';

export const DELIVEROO_DOMAIN = `
(define (domain ${DOMAIN_NAME})
  (:requirements :strips)
  (:predicates
    (at ?t)            ; the agent stands on tile ?t
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
)
`.trim();

/** Map solved plan action names back to game move directions. */
export const ACTION_TO_DIRECTION = {
  'move-up': 'up',
  'move-down': 'down',
  'move-left': 'left',
  'move-right': 'right',
};
