// Reading file 'xor5_x384.asc'..

module chip (input io_6_0_0, output io_7_4_0, input io_7_4_1, input io_7_5_0, input io_7_6_0, input io_7_6_1);

// (5, 1, 'neigh_op_bnr_0')
// (5, 1, 'neigh_op_bnr_4')
// (5, 1, 'sp4_r_v_b_40')
// (5, 2, 'sp4_r_v_b_29')
// (5, 3, 'sp4_r_v_b_16')
// (5, 4, 'sp4_r_v_b_5')
// (6, 0, 'io_0/D_IN_0')
// (6, 0, 'io_0/PAD')
// (6, 0, 'span4_vert_40')
// (6, 1, 'neigh_op_bot_0')
// (6, 1, 'neigh_op_bot_4')
// (6, 1, 'sp4_v_b_40')
// (6, 2, 'sp4_v_b_29')
// (6, 3, 'sp4_v_b_16')
// (6, 4, 'local_g0_5')
// (6, 4, 'lutff_3/in_2')
// (6, 4, 'sp4_v_b_5')

// (5, 3, 'neigh_op_tnr_3')
// (5, 4, 'neigh_op_rgt_3')
// (5, 5, 'neigh_op_bnr_3')
// (6, 3, 'neigh_op_top_3')
// (6, 4, 'lutff_3/out')
// (6, 5, 'neigh_op_bot_3')
// (7, 3, 'logic_op_tnl_3')
// (7, 4, 'io_0/D_OUT_0')
// (7, 4, 'io_0/PAD')
// (7, 4, 'local_g1_3')
// (7, 4, 'logic_op_lft_3')
// (7, 5, 'logic_op_bnl_3')

wire n3;
// (5, 3, 'sp4_r_v_b_47')
// (5, 4, 'sp4_r_v_b_34')
// (5, 5, 'neigh_op_tnr_5')
// (5, 5, 'sp4_r_v_b_23')
// (5, 6, 'neigh_op_rgt_5')
// (5, 6, 'sp4_r_v_b_10')
// (5, 7, 'neigh_op_bnr_5')
// (6, 2, 'sp4_v_t_47')
// (6, 3, 'sp4_v_b_47')
// (6, 4, 'local_g3_2')
// (6, 4, 'lutff_3/in_0')
// (6, 4, 'sp4_v_b_34')
// (6, 5, 'neigh_op_top_5')
// (6, 5, 'sp4_v_b_23')
// (6, 6, 'lutff_5/out')
// (6, 6, 'sp4_v_b_10')
// (6, 7, 'neigh_op_bot_5')
// (7, 5, 'logic_op_tnl_5')
// (7, 6, 'logic_op_lft_5')
// (7, 7, 'logic_op_bnl_5')

// (6, 3, 'neigh_op_tnr_2')
// (6, 3, 'neigh_op_tnr_6')
// (6, 4, 'local_g2_2')
// (6, 4, 'lutff_3/in_1')
// (6, 4, 'neigh_op_rgt_2')
// (6, 4, 'neigh_op_rgt_6')
// (6, 5, 'neigh_op_bnr_2')
// (6, 5, 'neigh_op_bnr_6')
// (7, 4, 'io_1/D_IN_0')
// (7, 4, 'io_1/PAD')

// (6, 4, 'local_g2_4')
// (6, 4, 'lutff_3/in_3')
// (6, 4, 'neigh_op_tnr_0')
// (6, 4, 'neigh_op_tnr_4')
// (6, 5, 'neigh_op_rgt_0')
// (6, 5, 'neigh_op_rgt_4')
// (6, 6, 'neigh_op_bnr_0')
// (6, 6, 'neigh_op_bnr_4')
// (7, 5, 'io_0/D_IN_0')
// (7, 5, 'io_0/PAD')

// (6, 5, 'neigh_op_tnr_0')
// (6, 5, 'neigh_op_tnr_4')
// (6, 6, 'local_g3_0')
// (6, 6, 'lutff_5/in_2')
// (6, 6, 'neigh_op_rgt_0')
// (6, 6, 'neigh_op_rgt_4')
// (6, 7, 'neigh_op_bnr_0')
// (6, 7, 'neigh_op_bnr_4')
// (7, 6, 'io_0/D_IN_0')
// (7, 6, 'io_0/PAD')

// (6, 5, 'neigh_op_tnr_2')
// (6, 5, 'neigh_op_tnr_6')
// (6, 6, 'local_g3_2')
// (6, 6, 'lutff_5/in_0')
// (6, 6, 'neigh_op_rgt_2')
// (6, 6, 'neigh_op_rgt_6')
// (6, 7, 'neigh_op_bnr_2')
// (6, 7, 'neigh_op_bnr_6')
// (7, 6, 'io_1/D_IN_0')
// (7, 6, 'io_1/PAD')

wire n8;
// (6, 6, 'lutff_5/lout')

wire n9;
// (6, 4, 'lutff_3/lout')

assign n8 = /* LUT    6  6  5 */ (io_7_6_0 ? !io_7_6_1 : io_7_6_1);
assign n9 = /* LUT    6  4  3 */ (io_7_5_0 ? (io_6_0_0 ? (io_7_4_1 ? !n3 : n3) : (io_7_4_1 ? n3 : !n3)) : (io_6_0_0 ? (io_7_4_1 ? n3 : !n3) : (io_7_4_1 ? !n3 : n3)));
/* FF  6  6  5 */ assign n3 = n8;
/* FF  6  4  3 */ assign io_7_4_0 = n9;

endmodule

