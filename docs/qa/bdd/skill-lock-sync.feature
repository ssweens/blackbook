Feature: Skill lock install-sync
  A skill lock (a profile's lock, or a project's skills-lock.json) is "in sync"
  when every skill it lists is actually installed in the agent skills directory
  and matches the source. This is about what is on disk — NOT whether the lock
  file is committed to git.

  One pure plan decides what an install must (re)install: everything missing on
  disk plus everything drifted. `P` apply on the Projects tab and
  `Enter → Install skills…` on the Profiles tab both use that same plan.

  Rule: Sync state reflects the agent skills directory

    @SYNC-1
    Scenario: In sync when every lock skill is installed
      Given a skill lock listing skills ["docx", "pdf"]
      And "docx" is installed in the agent skills directory
      And "pdf" is installed in the agent skills directory
      When the sync state is computed
      Then the state is "in-sync"
      And the list shows "in sync"

    @SYNC-2
    Scenario: Out of sync with a missing count when lock skills are not installed
      Given a skill lock listing skills ["docx", "pdf", "pptx", "xlsx"]
      When the sync state is computed
      Then the state is "out-of-sync"
      And 4 skills are missing
      And the list shows "out of sync · 4 missing"

    @SYNC-3
    Scenario: A skill installed but changed from its source is drifted
      Given a skill lock listing skills ["deslop"]
      And the source repo has "deslop" with content "original"
      And "deslop" is installed in the agent skills directory with content "edited"
      When the sync state is computed
      Then the state is "out-of-sync"
      And 1 skill is drifted
      And the list shows "out of sync · 1 drifted"

    @SYNC-4
    Scenario: Missing and drifted are both counted
      Given a skill lock listing skills ["deslop", "big-brain", "thread-map"]
      And the source repo has "deslop" with content "original"
      And "deslop" is installed in the agent skills directory with content "edited"
      When the sync state is computed
      Then 2 skills are missing
      And 1 skill is drifted
      And the list shows "out of sync · 2 missing, 1 drifted"

    @SYNC-5
    Scenario: An empty lock is reported distinctly, never as in sync
      Given an empty skill lock
      When the sync state is computed
      Then the state is "empty"
      And the list shows "empty"

  Rule: The install plan reconciles disk to the lock

    @SYNC-6
    Scenario: The plan installs exactly the missing skills
      Given a skill lock listing skills ["docx", "pdf", "pptx"]
      And "docx" is installed in the agent skills directory
      When the install plan is computed
      Then the install plan is ["pdf", "pptx"]

    @SYNC-7
    Scenario: A skill in the lock but missing on disk IS reinstalled
      Given a skill lock listing skills ["figure-it-out"]
      And "figure-it-out" is listed in the lock but missing from the agent skills directory
      When the install plan is computed
      Then the install plan includes "figure-it-out"

    @SYNC-8
    Scenario: A drifted skill is reinstalled
      Given a skill lock listing skills ["deslop"]
      And the source repo has "deslop" with content "original"
      And "deslop" is installed in the agent skills directory with content "edited"
      When the install plan is computed
      Then the install plan includes "deslop"

    @SYNC-9
    Scenario: Nothing to install when in sync
      Given a skill lock listing skills ["docx"]
      And "docx" is installed in the agent skills directory
      When the install plan is computed
      Then the install plan is empty

  Rule: One plan decides what an apply installs

    @SYNC-10
    Scenario: When the workspace lock already lists every skill, applying installs exactly the disk gap
      Given a skill lock listing skills ["docx", "pdf", "deslop"]
      And the source repo has "deslop" with content "original"
      And "deslop" is installed in the agent skills directory with content "edited"
      And "docx" is installed in the agent skills directory
      When the install plan is computed
      Then the apply plan against a workspace lock with the same skills equals the install plan
      And the install plan is ["deslop", "pdf"]

    @SYNC-11
    Scenario: A skill copied onto disk by hand but absent from the workspace lock is still applied
      Given a workspace whose lock lists skills []
      And a profile "Docs" listing skills ["docx"]
      And "docx" is installed in the agent skills directory
      When the apply plan for "Docs" against the workspace is computed
      Then the apply plan includes "docx"

  Rule: A source-repo skill the repo no longer has is reported, never silently "missing"

    @SYNC-12
    Scenario: A lock entry from the source repo that the repo no longer has is "not in source repo"
      Given a skill lock from the source repo "ssweens/playbook" listing skills ["deslop", "thread-map"]
      And the source repo has "deslop" with content "original"
      When the sync state is computed
      Then the state is "out-of-sync"
      And 1 skill is missing
      And 1 skill is not in the source repo
      And the list shows "out of sync · 1 missing, 1 not in source repo"

    @SYNC-13
    Scenario: The install plan excludes a skill nothing can install
      Given a skill lock from the source repo "ssweens/playbook" listing skills ["deslop", "thread-map"]
      And the source repo has "deslop" with content "original"
      When the install plan is computed
      Then the install plan is ["deslop"]

    @SYNC-14
    Scenario: A third-party skill is never judged against the source repo
      Given a skill lock from the source repo "ssweens/playbook" listing skills ["deslop"]
      And the source repo has "deslop" with content "original"
      And a profile "Docs" listing skills ["docx"]
      When the sync state is computed
      Then 2 skills are missing
      And 0 skills are not in the source repo

