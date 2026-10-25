"""curriculum: textbooks, units, unit words, per-unit progress

Revision ID: a1c9f4e07b52
Revises: 6cf33ce181c1
Create Date: 2026-10-24 22:41:07.553210

Written by hand and made **idempotent on purpose**. `init_db()` still runs
`Base.metadata.create_all` at startup, and the dev server runs with --reload: the
moment the new models are registered, create_all creates the four tables on its own
but will never add `conversations.unit_id`. A naive migration would then die with
"table already exists", leaving exactly the half-migrated schema this project has
already been burned by. Every step below checks the live schema first, so either
order — migrate-then-deploy or deploy-then-migrate — converges on the same result.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = 'a1c9f4e07b52'
down_revision: Union[str, None] = '6cf33ce181c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _bind():
    return op.get_bind()


def _tables():
    return set(inspect(_bind()).get_table_names())


def _columns(table: str):
    if table not in _tables():
        return set()
    return {c["name"] for c in inspect(_bind()).get_columns(table)}


def _indexes(table: str):
    if table not in _tables():
        return set()
    return {i["name"] for i in inspect(_bind()).get_indexes(table)}


def _create_table_if_missing(name: str, fn) -> None:
    if name not in _tables():
        fn()


def _create_index_if_missing(index_name: str, table: str, fn) -> None:
    if table in _tables():
        existing = {i["name"] for i in inspect(_bind()).get_indexes(table)}
        if index_name not in existing:
            fn()


def upgrade() -> None:
    def textbooks():
        op.create_table(
            'textbooks',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('publisher', sa.String(length=60), nullable=False),
            sa.Column('grade', sa.String(length=20), nullable=False),
            sa.Column('volume', sa.String(length=10), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint('id', name=op.f('pk_textbooks')),
            sa.UniqueConstraint('publisher', 'grade', 'volume', name='uq_textbook_level'),
        )

    def units():
        op.create_table(
            'units',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('textbook_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=120), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False),
            sa.Column('focus', sa.String(length=255), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ['textbook_id'], ['textbooks.id'],
                name=op.f('fk_units_textbook_id_textbooks'), ondelete='CASCADE',
            ),
            sa.PrimaryKeyConstraint('id', name=op.f('pk_units')),
        )
        _create_index_if_missing('ix_units_textbook_id', 'units', lambda: op.create_index(
            op.f('ix_units_textbook_id'), 'units', ['textbook_id'], unique=False))

    def unit_words():
        op.create_table(
            'unit_words',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('unit_id', sa.Integer(), nullable=False),
            sa.Column('word', sa.String(length=64), nullable=False),
            sa.Column('meaning_zh', sa.String(length=120), nullable=False),
            sa.Column('example', sa.String(length=255), nullable=True),
            sa.Column('position', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ['unit_id'], ['units.id'],
                name=op.f('fk_unit_words_unit_id_units'), ondelete='CASCADE',
            ),
            sa.PrimaryKeyConstraint('id', name=op.f('pk_unit_words')),
            sa.UniqueConstraint('unit_id', 'word', name='uq_unit_word'),
        )
        _create_index_if_missing('ix_unit_words_unit_id', 'unit_words', lambda: op.create_index(
            op.f('ix_unit_words_unit_id'), 'unit_words', ['unit_id'], unique=False))

    def unit_progress():
        op.create_table(
            'unit_progress',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('unit_id', sa.Integer(), nullable=False),
            sa.Column('attempts', sa.Integer(), nullable=False),
            sa.Column('best_overall', sa.Float(), nullable=True),
            sa.Column('completed', sa.Boolean(), nullable=False),
            sa.Column('last_practiced_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ['user_id'], ['users.id'],
                name=op.f('fk_unit_progress_user_id_users'), ondelete='CASCADE',
            ),
            sa.ForeignKeyConstraint(
                ['unit_id'], ['units.id'],
                name=op.f('fk_unit_progress_unit_id_units'), ondelete='CASCADE',
            ),
            sa.PrimaryKeyConstraint('id', name=op.f('pk_unit_progress')),
            sa.UniqueConstraint('user_id', 'unit_id', name='uq_user_unit_progress'),
        )
        _create_index_if_missing('ix_unit_progress_user_id', 'unit_progress', lambda: op.create_index(
            op.f('ix_unit_progress_user_id'), 'unit_progress', ['user_id'], unique=False))
        _create_index_if_missing('ix_unit_progress_unit_id', 'unit_progress', lambda: op.create_index(
            op.f('ix_unit_progress_unit_id'), 'unit_progress', ['unit_id'], unique=False))

    _create_table_if_missing('textbooks', textbooks)
    _create_table_if_missing('units', units)
    _create_table_if_missing('unit_words', unit_words)
    _create_table_if_missing('unit_progress', unit_progress)

    # The column create_all cannot add, and the reason this migration must run:
    # deleting a unit must not delete the conversations that practised it.
    #
    # batch mode is not optional here. SQLite cannot attach a foreign key to an
    # existing table, and `op.create_foreign_key()` after `add_column` raises
    # NotImplementedError — verified on a throwaway database. Alembic's batch mode
    # rebuilds the table via copy-and-move instead. Note the DDL is *not* rolled back
    # on failure, so a half-applied attempt leaves `unit_id` behind; the guard below is
    # what makes re-running after such a failure safe instead of fatal.
    if 'unit_id' not in _columns('conversations'):
        with op.batch_alter_table('conversations') as batch_op:
            batch_op.add_column(sa.Column('unit_id', sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                op.f('fk_conversations_unit_id_units'), 'units', ['unit_id'], ['id'],
                ondelete='SET NULL',
            )
    _create_index_if_missing('ix_conversations_unit_id', 'conversations', lambda: op.create_index(
        op.f('ix_conversations_unit_id'), 'conversations', ['unit_id'], unique=False))


def downgrade() -> None:
    if 'unit_id' in _columns('conversations'):
        # Guarded for the same reason upgrade is: a half-applied upgrade can leave the
        # column without its index, and an unguarded drop_index would abort the rollback.
        has_index = 'ix_conversations_unit_id' in _indexes('conversations')
        with op.batch_alter_table('conversations') as batch_op:
            if has_index:
                batch_op.drop_index(op.f('ix_conversations_unit_id'))
            batch_op.drop_constraint(op.f('fk_conversations_unit_id_units'), type_='foreignkey')
            batch_op.drop_column('unit_id')

    for table in ('unit_progress', 'unit_words', 'units', 'textbooks'):
        if table in _tables():
            op.drop_table(table)
