/* scr_fdlibm.c -- a GATED unit: the fdlibm routines behind Math.sin, cos, tan, asin, acos, atan, atan2, exp, expm1, log, log1p, log2, log10,
 * sinh, cosh, tanh, asinh, acosh, atanh, cbrt and hypot, in the form V8 carries them (src/base/ieee754.cc), so that a compiled program prints
 * the same bits Node prints. The platform libm answers differently in the last bits for most of these (measured against Node v24.15.0 on
 * 200,051 samples each: glibc differs on 0.02% (log2) to 51% (cbrt) of them), so no libm function stands in for any routine below.
 *
 * The routines are the Sun Microsystems fdlibm sources (a copyright notice follows) in the FreeBSD msun / musl arrangement for the argument
 * reduction and tan/expm1 kernels, and in the original Sun arrangement where V8's differs from them (the sin and cos kernels, log1p, exp,
 * the hyperbolics, asin/acos/atan, atan2, cbrt, log, log2, log10). Every routine here was checked to produce the bits Node prints on a
 * 200,051 sample set of its domain plus its edge values (+-0, +-Infinity, NaN, subnormals, huge arguments); see the corpus row
 * 24940 for the committed check. Nothing is contracted to a fused multiply-add: that would change the last bit.
 *
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 * The musl-derived pieces (__rem_pio2, __rem_pio2_large, __tan, expm1) carry the musl MIT license (Copyright 2005-2020 Rich Felker et al.).
 */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#if defined(__clang__)
#pragma clang fp contract(off)
#endif

/* The slice of musl's libm.h the vendored fdlibm sources use. */
#include <stdint.h>
#include <float.h>
#include <math.h>
#include <string.h>
static inline double fd_eval_as_double(double x) { double y = x; return y; }
#define eval_as_double fd_eval_as_double
static inline double fd_fp_barrier(double x) { volatile double y = x; return y; }
#define fp_barrier fd_fp_barrier
static inline void fd_fp_force_eval(double x) { volatile double y; y = x; }
#define FORCE_EVAL(x) fd_fp_force_eval(x)
#define predict_true(x) __builtin_expect(!!(x), 1)
#define predict_false(x) __builtin_expect(x, 0)
static inline uint64_t fd_asuint64(double f) { uint64_t i; memcpy(&i, &f, 8); return i; }
static inline double fd_asdouble(uint64_t i) { double f; memcpy(&f, &i, 8); return f; }
#define asuint64(f) fd_asuint64(f)
#define asdouble(i) fd_asdouble(i)
#define EXTRACT_WORDS(hi,lo,d) do { uint64_t __u = asuint64(d); (hi) = __u >> 32; (lo) = (uint32_t)__u; } while (0)
#define GET_HIGH_WORD(hi,d) do { (hi) = asuint64(d) >> 32; } while (0)
#define GET_LOW_WORD(lo,d) do { (lo) = (uint32_t)asuint64(d); } while (0)
#define INSERT_WORDS(d,hi,lo) do { (d) = asdouble(((uint64_t)(hi)<<32) | (uint32_t)(lo)); } while (0)
#define SET_HIGH_WORD(d,hi) INSERT_WORDS(d, hi, (uint32_t)asuint64(d))
#define SET_LOW_WORD(d,lo) INSERT_WORDS(d, asuint64(d)>>32, lo)

#define __rem_pio2_large scr_fd___rem_pio2_large
#define __rem_pio2 scr_fd___rem_pio2
#define __tan scr_fd___tan
#define expm1 scr_fd_expm1
int __rem_pio2_large(double*,double*,int,int,int);
int __rem_pio2(double,double*);
double __tan(double,double,int);
double scr_fd___sin(double,double,int);
double scr_fd___cos(double,double);

/* ===== __rem_pio2_large.c ===== */
#define PIo2 fd___rem_pio2_large_PIo2
#define init_jk fd___rem_pio2_large_init_jk
#define ipio2 fd___rem_pio2_large_ipio2
/* origin: FreeBSD /usr/src/lib/msun/src/k_rem_pio2.c */
/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */
/*
 * __rem_pio2_large(x,y,e0,nx,prec)
 * double x[],y[]; int e0,nx,prec;
 *
 * __rem_pio2_large return the last three digits of N with
 *              y = x - N*pi/2
 * so that |y| < pi/2.
 *
 * The method is to compute the integer (mod 8) and fraction parts of
 * (2/pi)*x without doing the full multiplication. In general we
 * skip the part of the product that are known to be a huge integer (
 * more accurately, = 0 mod 8 ). Thus the number of operations are
 * independent of the exponent of the input.
 *
 * (2/pi) is represented by an array of 24-bit integers in ipio2[].
 *
 * Input parameters:
 *      x[]     The input value (must be positive) is broken into nx
 *              pieces of 24-bit integers in double precision format.
 *              x[i] will be the i-th 24 bit of x. The scaled exponent
 *              of x[0] is given in input parameter e0 (i.e., x[0]*2^e0
 *              match x's up to 24 bits.
 *
 *              Example of breaking a double positive z into x[0]+x[1]+x[2]:
 *                      e0 = ilogb(z)-23
 *                      z  = scalbn(z,-e0)
 *              for i = 0,1,2
 *                      x[i] = floor(z)
 *                      z    = (z-x[i])*2**24
 *
 *
 *      y[]     ouput result in an array of double precision numbers.
 *              The dimension of y[] is:
 *                      24-bit  precision       1
 *                      53-bit  precision       2
 *                      64-bit  precision       2
 *                      113-bit precision       3
 *              The actual value is the sum of them. Thus for 113-bit
 *              precison, one may have to do something like:
 *
 *              long double t,w,r_head, r_tail;
 *              t = (long double)y[2] + (long double)y[1];
 *              w = (long double)y[0];
 *              r_head = t+w;
 *              r_tail = w - (r_head - t);
 *
 *      e0      The exponent of x[0]. Must be <= 16360 or you need to
 *              expand the ipio2 table.
 *
 *      nx      dimension of x[]
 *
 *      prec    an integer indicating the precision:
 *                      0       24  bits (single)
 *                      1       53  bits (double)
 *                      2       64  bits (extended)
 *                      3       113 bits (quad)
 *
 * External function:
 *      double scalbn(), floor();
 *
 *
 * Here is the description of some local variables:
 *
 *      jk      jk+1 is the initial number of terms of ipio2[] needed
 *              in the computation. The minimum and recommended value
 *              for jk is 3,4,4,6 for single, double, extended, and quad.
 *              jk+1 must be 2 larger than you might expect so that our
 *              recomputation test works. (Up to 24 bits in the integer
 *              part (the 24 bits of it that we compute) and 23 bits in
 *              the fraction part may be lost to cancelation before we
 *              recompute.)
 *
 *      jz      local integer variable indicating the number of
 *              terms of ipio2[] used.
 *
 *      jx      nx - 1
 *
 *      jv      index for pointing to the suitable ipio2[] for the
 *              computation. In general, we want
 *                      ( 2^e0*x[0] * ipio2[jv-1]*2^(-24jv) )/8
 *              is an integer. Thus
 *                      e0-3-24*jv >= 0 or (e0-3)/24 >= jv
 *              Hence jv = max(0,(e0-3)/24).
 *
 *      jp      jp+1 is the number of terms in PIo2[] needed, jp = jk.
 *
 *      q[]     double array with integral value, representing the
 *              24-bits chunk of the product of x and 2/pi.
 *
 *      q0      the corresponding exponent of q[0]. Note that the
 *              exponent for q[i] would be q0-24*i.
 *
 *      PIo2[]  double precision array, obtained by cutting pi/2
 *              into 24 bits chunks.
 *
 *      f[]     ipio2[] in floating point
 *
 *      iq[]    integer array by breaking up q[] in 24-bits chunk.
 *
 *      fq[]    final product of x*(2/pi) in fq[0],..,fq[jk]
 *
 *      ih      integer. If >0 it indicates q[] is >= 0.5, hence
 *              it also indicates the *sign* of the result.
 *
 */
/*
 * Constants:
 * The hexadecimal values are the intended ones for the following
 * constants. The decimal values may be used, provided that the
 * compiler will convert from decimal to binary accurately enough
 * to produce the hexadecimal values shown.
 */


static const int init_jk[] = {3,4,4,6}; /* initial value for jk */

/*
 * Table of constants for 2/pi, 396 Hex digits (476 decimal) of 2/pi
 *
 *              integer array, contains the (24*i)-th to (24*i+23)-th
 *              bit of 2/pi after binary point. The corresponding
 *              floating value is
 *
 *                      ipio2[i] * 2^(-24(i+1)).
 *
 * NB: This table must have at least (e0-3)/24 + jk terms.
 *     For quad precision (e0 <= 16360, jk = 6), this is 686.
 */
static const int32_t ipio2[] = {
0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62,
0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8,
0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B,

#if LDBL_MAX_EXP > 1024
0x47C419, 0xC367CD, 0xDCE809, 0x2A8359, 0xC4768B, 0x961CA6,
0xDDAF44, 0xD15719, 0x053EA5, 0xFF0705, 0x3F7E33, 0xE832C2,
0xDE4F98, 0x327DBB, 0xC33D26, 0xEF6B1E, 0x5EF89F, 0x3A1F35,
0xCAF27F, 0x1D87F1, 0x21907C, 0x7C246A, 0xFA6ED5, 0x772D30,
0x433B15, 0xC614B5, 0x9D19C3, 0xC2C4AD, 0x414D2C, 0x5D000C,
0x467D86, 0x2D71E3, 0x9AC69B, 0x006233, 0x7CD2B4, 0x97A7B4,
0xD55537, 0xF63ED7, 0x1810A3, 0xFC764D, 0x2A9D64, 0xABD770,
0xF87C63, 0x57B07A, 0xE71517, 0x5649C0, 0xD9D63B, 0x3884A7,
0xCB2324, 0x778AD6, 0x23545A, 0xB91F00, 0x1B0AF1, 0xDFCE19,
0xFF319F, 0x6A1E66, 0x615799, 0x47FBAC, 0xD87F7E, 0xB76522,
0x89E832, 0x60BFE6, 0xCDC4EF, 0x09366C, 0xD43F5D, 0xD7DE16,
0xDE3B58, 0x929BDE, 0x2822D2, 0xE88628, 0x4D58E2, 0x32CAC6,
0x16E308, 0xCB7DE0, 0x50C017, 0xA71DF3, 0x5BE018, 0x34132E,
0x621283, 0x014883, 0x5B8EF5, 0x7FB0AD, 0xF2E91E, 0x434A48,
0xD36710, 0xD8DDAA, 0x425FAE, 0xCE616A, 0xA4280A, 0xB499D3,
0xF2A606, 0x7F775C, 0x83C2A3, 0x883C61, 0x78738A, 0x5A8CAF,
0xBDD76F, 0x63A62D, 0xCBBFF4, 0xEF818D, 0x67C126, 0x45CA55,
0x36D9CA, 0xD2A828, 0x8D61C2, 0x77C912, 0x142604, 0x9B4612,
0xC459C4, 0x44C5C8, 0x91B24D, 0xF31700, 0xAD43D4, 0xE54929,
0x10D5FD, 0xFCBE00, 0xCC941E, 0xEECE70, 0xF53E13, 0x80F1EC,
0xC3E7B3, 0x28F8C7, 0x940593, 0x3E71C1, 0xB3092E, 0xF3450B,
0x9C1288, 0x7B20AB, 0x9FB52E, 0xC29247, 0x2F327B, 0x6D550C,
0x90A772, 0x1FE76B, 0x96CB31, 0x4A1679, 0xE27941, 0x89DFF4,
0x9794E8, 0x84E6E2, 0x973199, 0x6BED88, 0x365F5F, 0x0EFDBB,
0xB49A48, 0x6CA467, 0x427271, 0x325D8D, 0xB8159F, 0x09E5BC,
0x25318D, 0x3974F7, 0x1C0530, 0x010C0D, 0x68084B, 0x58EE2C,
0x90AA47, 0x02E774, 0x24D6BD, 0xA67DF7, 0x72486E, 0xEF169F,
0xA6948E, 0xF691B4, 0x5153D1, 0xF20ACF, 0x339820, 0x7E4BF5,
0x6863B2, 0x5F3EDD, 0x035D40, 0x7F8985, 0x295255, 0xC06437,
0x10D86D, 0x324832, 0x754C5B, 0xD4714E, 0x6E5445, 0xC1090B,
0x69F52A, 0xD56614, 0x9D0727, 0x50045D, 0xDB3BB4, 0xC576EA,
0x17F987, 0x7D6B49, 0xBA271D, 0x296996, 0xACCCC6, 0x5414AD,
0x6AE290, 0x89D988, 0x50722C, 0xBEA404, 0x940777, 0x7030F3,
0x27FC00, 0xA871EA, 0x49C266, 0x3DE064, 0x83DD97, 0x973FA3,
0xFD9443, 0x8C860D, 0xDE4131, 0x9D3992, 0x8C70DD, 0xE7B717,
0x3BDF08, 0x2B3715, 0xA0805C, 0x93805A, 0x921110, 0xD8E80F,
0xAF806C, 0x4BFFDB, 0x0F9038, 0x761859, 0x15A562, 0xBBCB61,
0xB989C7, 0xBD4010, 0x04F2D2, 0x277549, 0xF6B6EB, 0xBB22DB,
0xAA140A, 0x2F2689, 0x768364, 0x333B09, 0x1A940E, 0xAA3A51,
0xC2A31D, 0xAEEDAF, 0x12265C, 0x4DC26D, 0x9C7A2D, 0x9756C0,
0x833F03, 0xF6F009, 0x8C402B, 0x99316D, 0x07B439, 0x15200C,
0x5BC3D8, 0xC492F5, 0x4BADC6, 0xA5CA4E, 0xCD37A7, 0x36A9E6,
0x9492AB, 0x6842DD, 0xDE6319, 0xEF8C76, 0x528B68, 0x37DBFC,
0xABA1AE, 0x3115DF, 0xA1AE00, 0xDAFB0C, 0x664D64, 0xB705ED,
0x306529, 0xBF5657, 0x3AFF47, 0xB9F96A, 0xF3BE75, 0xDF9328,
0x3080AB, 0xF68C66, 0x15CB04, 0x0622FA, 0x1DE4D9, 0xA4B33D,
0x8F1B57, 0x09CD36, 0xE9424E, 0xA4BE13, 0xB52333, 0x1AAAF0,
0xA8654F, 0xA5C1D2, 0x0F3F0B, 0xCD785B, 0x76F923, 0x048B7B,
0x721789, 0x53A6C6, 0xE26E6F, 0x00EBEF, 0x584A9B, 0xB7DAC4,
0xBA66AA, 0xCFCF76, 0x1D02D1, 0x2DF1B1, 0xC1998C, 0x77ADC3,
0xDA4886, 0xA05DF7, 0xF480C6, 0x2FF0AC, 0x9AECDD, 0xBC5C3F,
0x6DDED0, 0x1FC790, 0xB6DB2A, 0x3A25A3, 0x9AAF00, 0x9353AD,
0x0457B6, 0xB42D29, 0x7E804B, 0xA707DA, 0x0EAA76, 0xA1597B,
0x2A1216, 0x2DB7DC, 0xFDE5FA, 0xFEDB89, 0xFDBE89, 0x6C76E4,
0xFCA906, 0x70803E, 0x156E85, 0xFF87FD, 0x073E28, 0x336761,
0x86182A, 0xEABD4D, 0xAFE7B3, 0x6E6D8F, 0x396795, 0x5BBF31,
0x48D784, 0x16DF30, 0x432DC7, 0x356125, 0xCE70C9, 0xB8CB30,
0xFD6CBF, 0xA200A4, 0xE46C05, 0xA0DD5A, 0x476F21, 0xD21262,
0x845CB9, 0x496170, 0xE0566B, 0x015299, 0x375550, 0xB7D51E,
0xC4F133, 0x5F6E13, 0xE4305D, 0xA92E85, 0xC3B21D, 0x3632A1,
0xA4B708, 0xD4B1EA, 0x21F716, 0xE4698F, 0x77FF27, 0x80030C,
0x2D408D, 0xA0CD4F, 0x99A520, 0xD3A2B3, 0x0A5D2F, 0x42F9B4,
0xCBDA11, 0xD0BE7D, 0xC1DB9B, 0xBD17AB, 0x81A2CA, 0x5C6A08,
0x17552E, 0x550027, 0xF0147F, 0x8607E1, 0x640B14, 0x8D4196,
0xDEBE87, 0x2AFDDA, 0xB6256B, 0x34897B, 0xFEF305, 0x9EBFB9,
0x4F6A68, 0xA82A4A, 0x5AC44F, 0xBCF82D, 0x985AD7, 0x95C7F4,
0x8D4D0D, 0xA63A20, 0x5F57A4, 0xB13F14, 0x953880, 0x0120CC,
0x86DD71, 0xB6DEC9, 0xF560BF, 0x11654D, 0x6B0701, 0xACB08C,
0xD0C0B2, 0x485551, 0x0EFB1E, 0xC37295, 0x3B06A3, 0x3540C0,
0x7BDC06, 0xCC45E0, 0xFA294E, 0xC8CAD6, 0x41F3E8, 0xDE647C,
0xD8649B, 0x31BED9, 0xC397A4, 0xD45877, 0xC5E369, 0x13DAF0,
0x3C3ABA, 0x461846, 0x5F7555, 0xF5BDD2, 0xC6926E, 0x5D2EAC,
0xED440E, 0x423E1C, 0x87C461, 0xE9FD29, 0xF3D6E7, 0xCA7C22,
0x35916F, 0xC5E008, 0x8DD7FF, 0xE26A6E, 0xC6FDB0, 0xC10893,
0x745D7C, 0xB2AD6B, 0x9D6ECD, 0x7B723E, 0x6A11C6, 0xA9CFF7,
0xDF7329, 0xBAC9B5, 0x5100B7, 0x0DB2E2, 0x24BA74, 0x607DE5,
0x8AD874, 0x2C150D, 0x0C1881, 0x94667E, 0x162901, 0x767A9F,
0xBEFDFD, 0xEF4556, 0x367ED9, 0x13D9EC, 0xB9BA8B, 0xFC97C4,
0x27A831, 0xC36EF1, 0x36C594, 0x56A8D8, 0xB5A8B4, 0x0ECCCF,
0x2D8912, 0x34576F, 0x89562C, 0xE3CE99, 0xB920D6, 0xAA5E6B,
0x9C2A3E, 0xCC5F11, 0x4A0BFD, 0xFBF4E1, 0x6D3B8E, 0x2C86E2,
0x84D4E9, 0xA9B4FC, 0xD1EEEF, 0xC9352E, 0x61392F, 0x442138,
0xC8D91B, 0x0AFC81, 0x6A4AFB, 0xD81C2F, 0x84B453, 0x8C994E,
0xCC2254, 0xDC552A, 0xD6C6C0, 0x96190B, 0xB8701A, 0x649569,
0x605A26, 0xEE523F, 0x0F117F, 0x11B5F4, 0xF5CBFC, 0x2DBC34,
0xEEBC34, 0xCC5DE8, 0x605EDD, 0x9B8E67, 0xEF3392, 0xB817C9,
0x9B5861, 0xBC57E1, 0xC68351, 0x103ED8, 0x4871DD, 0xDD1C2D,
0xA118AF, 0x462C21, 0xD7F359, 0x987AD9, 0xC0549E, 0xFA864F,
0xFC0656, 0xAE79E5, 0x362289, 0x22AD38, 0xDC9367, 0xAAE855,
0x382682, 0x9BE7CA, 0xA40D51, 0xB13399, 0x0ED7A9, 0x480569,
0xF0B265, 0xA7887F, 0x974C88, 0x36D1F9, 0xB39221, 0x4A827B,
0x21CF98, 0xDC9F40, 0x5547DC, 0x3A74E1, 0x42EB67, 0xDF9DFE,
0x5FD45E, 0xA4677B, 0x7AACBA, 0xA2F655, 0x23882B, 0x55BA41,
0x086E59, 0x862A21, 0x834739, 0xE6E389, 0xD49EE5, 0x40FB49,
0xE956FF, 0xCA0F1C, 0x8A59C5, 0x2BFA94, 0xC5C1D3, 0xCFC50F,
0xAE5ADB, 0x86C547, 0x624385, 0x3B8621, 0x94792C, 0x876110,
0x7B4C2A, 0x1A2C80, 0x12BF43, 0x902688, 0x893C78, 0xE4C4A8,
0x7BDBE5, 0xC23AC4, 0xEAF426, 0x8A67F7, 0xBF920D, 0x2BA365,
0xB1933D, 0x0B7CBD, 0xDC51A4, 0x63DD27, 0xDDE169, 0x19949A,
0x9529A8, 0x28CE68, 0xB4ED09, 0x209F44, 0xCA984E, 0x638270,
0x237C7E, 0x32B90F, 0x8EF5A7, 0xE75614, 0x08F121, 0x2A9DB5,
0x4D7E6F, 0x5119A5, 0xABF9B5, 0xD6DF82, 0x61DD96, 0x023616,
0x9F3AC4, 0xA1A283, 0x6DED72, 0x7A8D39, 0xA9B882, 0x5C326B,
0x5B2746, 0xED3400, 0x7700D2, 0x55F4FC, 0x4D5901, 0x8071E0,
#endif
};

static const double PIo2[] = {
  1.57079625129699707031e+00, /* 0x3FF921FB, 0x40000000 */
  7.54978941586159635335e-08, /* 0x3E74442D, 0x00000000 */
  5.39030252995776476554e-15, /* 0x3CF84698, 0x80000000 */
  3.28200341580791294123e-22, /* 0x3B78CC51, 0x60000000 */
  1.27065575308067607349e-29, /* 0x39F01B83, 0x80000000 */
  1.22933308981111328932e-36, /* 0x387A2520, 0x40000000 */
  2.73370053816464559624e-44, /* 0x36E38222, 0x80000000 */
  2.16741683877804819444e-51, /* 0x3569F31D, 0x00000000 */
};

int __rem_pio2_large(double *x, double *y, int e0, int nx, int prec)
{
	int32_t jz,jx,jv,jp,jk,carry,n,iq[20],i,j,k,m,q0,ih;
	double z,fw,f[20],fq[20],q[20];

	/* initialize jk*/
	jk = init_jk[prec];
	jp = jk;

	/* determine jx,jv,q0, note that 3>q0 */
	jx = nx-1;
	jv = (e0-3)/24;  if(jv<0) jv=0;
	q0 = e0-24*(jv+1);

	/* set up f[0] to f[jx+jk] where f[jx+jk] = ipio2[jv+jk] */
	j = jv-jx; m = jx+jk;
	for (i=0; i<=m; i++,j++)
		f[i] = j<0 ? 0.0 : (double)ipio2[j];

	/* compute q[0],q[1],...q[jk] */
	for (i=0; i<=jk; i++) {
		for (j=0,fw=0.0; j<=jx; j++)
			fw += x[j]*f[jx+i-j];
		q[i] = fw;
	}

	jz = jk;
recompute:
	/* distill q[] into iq[] reversingly */
	for (i=0,j=jz,z=q[jz]; j>0; i++,j--) {
		fw    = (double)(int32_t)(0x1p-24*z);
		iq[i] = (int32_t)(z - 0x1p24*fw);
		z     = q[j-1]+fw;
	}

	/* compute n */
	z  = scalbn(z,q0);       /* actual value of z */
	z -= 8.0*floor(z*0.125); /* trim off integer >= 8 */
	n  = (int32_t)z;
	z -= (double)n;
	ih = 0;
	if (q0 > 0) {  /* need iq[jz-1] to determine n */
		i  = iq[jz-1]>>(24-q0); n += i;
		iq[jz-1] -= i<<(24-q0);
		ih = iq[jz-1]>>(23-q0);
	}
	else if (q0 == 0) ih = iq[jz-1]>>23;
	else if (z >= 0.5) ih = 2;

	if (ih > 0) {  /* q > 0.5 */
		n += 1; carry = 0;
		for (i=0; i<jz; i++) {  /* compute 1-q */
			j = iq[i];
			if (carry == 0) {
				if (j != 0) {
					carry = 1;
					iq[i] = 0x1000000 - j;
				}
			} else
				iq[i] = 0xffffff - j;
		}
		if (q0 > 0) {  /* rare case: chance is 1 in 12 */
			switch(q0) {
			case 1:
				iq[jz-1] &= 0x7fffff; break;
			case 2:
				iq[jz-1] &= 0x3fffff; break;
			}
		}
		if (ih == 2) {
			z = 1.0 - z;
			if (carry != 0)
				z -= scalbn(1.0,q0);
		}
	}

	/* check if recomputation is needed */
	if (z == 0.0) {
		j = 0;
		for (i=jz-1; i>=jk; i--) j |= iq[i];
		if (j == 0) {  /* need recomputation */
			for (k=1; iq[jk-k]==0; k++);  /* k = no. of terms needed */

			for (i=jz+1; i<=jz+k; i++) {  /* add q[jz+1] to q[jz+k] */
				f[jx+i] = (double)ipio2[jv+i];
				for (j=0,fw=0.0; j<=jx; j++)
					fw += x[j]*f[jx+i-j];
				q[i] = fw;
			}
			jz += k;
			goto recompute;
		}
	}

	/* chop off zero terms */
	if (z == 0.0) {
		jz -= 1;
		q0 -= 24;
		while (iq[jz] == 0) {
			jz--;
			q0 -= 24;
		}
	} else { /* break z into 24-bit if necessary */
		z = scalbn(z,-q0);
		if (z >= 0x1p24) {
			fw = (double)(int32_t)(0x1p-24*z);
			iq[jz] = (int32_t)(z - 0x1p24*fw);
			jz += 1;
			q0 += 24;
			iq[jz] = (int32_t)fw;
		} else
			iq[jz] = (int32_t)z;
	}

	/* convert integer "bit" chunk to floating-point value */
	fw = scalbn(1.0,q0);
	for (i=jz; i>=0; i--) {
		q[i] = fw*(double)iq[i];
		fw *= 0x1p-24;
	}

	/* compute PIo2[0,...,jp]*q[jz,...,0] */
	for(i=jz; i>=0; i--) {
		for (fw=0.0,k=0; k<=jp && k<=jz-i; k++)
			fw += PIo2[k]*q[i+k];
		fq[jz-i] = fw;
	}

	/* compress fq[] into y[] */
	switch(prec) {
	case 0:
		fw = 0.0;
		for (i=jz; i>=0; i--)
			fw += fq[i];
		y[0] = ih==0 ? fw : -fw;
		break;
	case 1:
	case 2:
		fw = 0.0;
		for (i=jz; i>=0; i--)
			fw += fq[i];
		// TODO: drop excess precision here once double_t is used
		fw = (double)fw;
		y[0] = ih==0 ? fw : -fw;
		fw = fq[0]-fw;
		for (i=1; i<=jz; i++)
			fw += fq[i];
		y[1] = ih==0 ? fw : -fw;
		break;
	case 3:  /* painful */
		for (i=jz; i>0; i--) {
			fw      = fq[i-1]+fq[i];
			fq[i]  += fq[i-1]-fw;
			fq[i-1] = fw;
		}
		for (i=jz; i>1; i--) {
			fw      = fq[i-1]+fq[i];
			fq[i]  += fq[i-1]-fw;
			fq[i-1] = fw;
		}
		for (fw=0.0,i=jz; i>=2; i--)
			fw += fq[i];
		if (ih==0) {
			y[0] =  fq[0]; y[1] =  fq[1]; y[2] =  fw;
		} else {
			y[0] = -fq[0]; y[1] = -fq[1]; y[2] = -fw;
		}
	}
	return n&7;
}

#undef PIo2
#undef init_jk
#undef ipio2
/* ===== __rem_pio2.c ===== */
#define invpio2 fd___rem_pio2_invpio2
#define pio2_1 fd___rem_pio2_pio2_1
#define pio2_1t fd___rem_pio2_pio2_1t
#define pio2_2 fd___rem_pio2_pio2_2
#define pio2_2t fd___rem_pio2_pio2_2t
#define pio2_3 fd___rem_pio2_pio2_3
#define pio2_3t fd___rem_pio2_pio2_3t
#define pio4 fd___rem_pio2_pio4
#define toint fd___rem_pio2_toint
/* origin: FreeBSD /usr/src/lib/msun/src/e_rem_pio2.c */
/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * Optimized by Bruce D. Evans.
 */
/* __rem_pio2(x,y)
 *
 * return the remainder of x rem pi/2 in y[0]+y[1]
 * use __rem_pio2_large() for large x
 */


#if FLT_EVAL_METHOD==0 || FLT_EVAL_METHOD==1
#define EPS DBL_EPSILON
#elif FLT_EVAL_METHOD==2
#define EPS LDBL_EPSILON
#endif

/*
 * invpio2:  53 bits of 2/pi
 * pio2_1:   first  33 bit of pi/2
 * pio2_1t:  pi/2 - pio2_1
 * pio2_2:   second 33 bit of pi/2
 * pio2_2t:  pi/2 - (pio2_1+pio2_2)
 * pio2_3:   third  33 bit of pi/2
 * pio2_3t:  pi/2 - (pio2_1+pio2_2+pio2_3)
 */
static const double
toint   = 1.5/EPS,
pio4    = 0x1.921fb54442d18p-1,
invpio2 = 6.36619772367581382433e-01, /* 0x3FE45F30, 0x6DC9C883 */
pio2_1  = 1.57079632673412561417e+00, /* 0x3FF921FB, 0x54400000 */
pio2_1t = 6.07710050650619224932e-11, /* 0x3DD0B461, 0x1A626331 */
pio2_2  = 6.07710050630396597660e-11, /* 0x3DD0B461, 0x1A600000 */
pio2_2t = 2.02226624879595063154e-21, /* 0x3BA3198A, 0x2E037073 */
pio2_3  = 2.02226624871116645580e-21, /* 0x3BA3198A, 0x2E000000 */
pio2_3t = 8.47842766036889956997e-32; /* 0x397B839A, 0x252049C1 */

/* caller must handle the case when reduction is not needed: |x| ~<= pi/4 */
int __rem_pio2(double x, double *y)
{
	union {double f; uint64_t i;} u = {x};
	double_t z,w,t,r,fn;
	double tx[3],ty[2];
	uint32_t ix;
	int sign, n, ex, ey, i;

	sign = u.i>>63;
	ix = u.i>>32 & 0x7fffffff;
	if (ix <= 0x400f6a7a) {  /* |x| ~<= 5pi/4 */
		if ((ix & 0xfffff) == 0x921fb)  /* |x| ~= pi/2 or 2pi/2 */
			goto medium;  /* cancellation -- use medium case */
		if (ix <= 0x4002d97c) {  /* |x| ~<= 3pi/4 */
			if (!sign) {
				z = x - pio2_1;  /* one round good to 85 bits */
				y[0] = z - pio2_1t;
				y[1] = (z-y[0]) - pio2_1t;
				return 1;
			} else {
				z = x + pio2_1;
				y[0] = z + pio2_1t;
				y[1] = (z-y[0]) + pio2_1t;
				return -1;
			}
		} else {
			if (!sign) {
				z = x - 2*pio2_1;
				y[0] = z - 2*pio2_1t;
				y[1] = (z-y[0]) - 2*pio2_1t;
				return 2;
			} else {
				z = x + 2*pio2_1;
				y[0] = z + 2*pio2_1t;
				y[1] = (z-y[0]) + 2*pio2_1t;
				return -2;
			}
		}
	}
	if (ix <= 0x401c463b) {  /* |x| ~<= 9pi/4 */
		if (ix <= 0x4015fdbc) {  /* |x| ~<= 7pi/4 */
			if (ix == 0x4012d97c)  /* |x| ~= 3pi/2 */
				goto medium;
			if (!sign) {
				z = x - 3*pio2_1;
				y[0] = z - 3*pio2_1t;
				y[1] = (z-y[0]) - 3*pio2_1t;
				return 3;
			} else {
				z = x + 3*pio2_1;
				y[0] = z + 3*pio2_1t;
				y[1] = (z-y[0]) + 3*pio2_1t;
				return -3;
			}
		} else {
			if (ix == 0x401921fb)  /* |x| ~= 4pi/2 */
				goto medium;
			if (!sign) {
				z = x - 4*pio2_1;
				y[0] = z - 4*pio2_1t;
				y[1] = (z-y[0]) - 4*pio2_1t;
				return 4;
			} else {
				z = x + 4*pio2_1;
				y[0] = z + 4*pio2_1t;
				y[1] = (z-y[0]) + 4*pio2_1t;
				return -4;
			}
		}
	}
	if (ix < 0x413921fb) {  /* |x| ~< 2^20*(pi/2), medium size */
medium:
		/* rint(x/(pi/2)) */
		fn = (double_t)x*invpio2 + toint - toint;
		n = (int32_t)fn;
		r = x - fn*pio2_1;
		w = fn*pio2_1t;  /* 1st round, good to 85 bits */
		/* Matters with directed rounding. */
		if (predict_false(r - w < -pio4)) {
			n--;
			fn--;
			r = x - fn*pio2_1;
			w = fn*pio2_1t;
		} else if (predict_false(r - w > pio4)) {
			n++;
			fn++;
			r = x - fn*pio2_1;
			w = fn*pio2_1t;
		}
		y[0] = r - w;
		u.f = y[0];
		ey = u.i>>52 & 0x7ff;
		ex = ix>>20;
		if (ex - ey > 16) { /* 2nd round, good to 118 bits */
			t = r;
			w = fn*pio2_2;
			r = t - w;
			w = fn*pio2_2t - ((t-r)-w);
			y[0] = r - w;
			u.f = y[0];
			ey = u.i>>52 & 0x7ff;
			if (ex - ey > 49) {  /* 3rd round, good to 151 bits, covers all cases */
				t = r;
				w = fn*pio2_3;
				r = t - w;
				w = fn*pio2_3t - ((t-r)-w);
				y[0] = r - w;
			}
		}
		y[1] = (r - y[0]) - w;
		return n;
	}
	/*
	 * all other (large) arguments
	 */
	if (ix >= 0x7ff00000) {  /* x is inf or NaN */
		y[0] = y[1] = x - x;
		return 0;
	}
	/* set z = scalbn(|x|,-ilogb(x)+23) */
	u.f = x;
	u.i &= (uint64_t)-1>>12;
	u.i |= (uint64_t)(0x3ff + 23)<<52;
	z = u.f;
	for (i=0; i < 2; i++) {
		tx[i] = (double)(int32_t)z;
		z     = (z-tx[i])*0x1p24;
	}
	tx[i] = z;
	/* skip zero terms, first term is non-zero */
	while (tx[i] == 0.0)
		i--;
	n = __rem_pio2_large(tx,ty,(int)(ix>>20)-(0x3ff+23),i+1,1);
	if (sign) {
		y[0] = -ty[0];
		y[1] = -ty[1];
		return -n;
	}
	y[0] = ty[0];
	y[1] = ty[1];
	return n;
}

#undef invpio2
#undef pio2_1
#undef pio2_1t
#undef pio2_2
#undef pio2_2t
#undef pio2_3
#undef pio2_3t
#undef pio4
#undef toint
/* ===== __tan.c ===== */
#define T fd___tan_T
#define pio4 fd___tan_pio4
#define pio4lo fd___tan_pio4lo
/* origin: FreeBSD /usr/src/lib/msun/src/k_tan.c */
/*
 * ====================================================
 * Copyright 2004 Sun Microsystems, Inc.  All Rights Reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */
/* __tan( x, y, k )
 * kernel tan function on ~[-pi/4, pi/4] (except on -0), pi/4 ~ 0.7854
 * Input x is assumed to be bounded by ~pi/4 in magnitude.
 * Input y is the tail of x.
 * Input odd indicates whether tan (if odd = 0) or -1/tan (if odd = 1) is returned.
 *
 * Algorithm
 *      1. Since tan(-x) = -tan(x), we need only to consider positive x.
 *      2. Callers must return tan(-0) = -0 without calling here since our
 *         odd polynomial is not evaluated in a way that preserves -0.
 *         Callers may do the optimization tan(x) ~ x for tiny x.
 *      3. tan(x) is approximated by a odd polynomial of degree 27 on
 *         [0,0.67434]
 *                               3             27
 *              tan(x) ~ x + T1*x + ... + T13*x
 *         where
 *
 *              |tan(x)         2     4            26   |     -59.2
 *              |----- - (1+T1*x +T2*x +.... +T13*x    )| <= 2
 *              |  x                                    |
 *
 *         Note: tan(x+y) = tan(x) + tan'(x)*y
 *                        ~ tan(x) + (1+x*x)*y
 *         Therefore, for better accuracy in computing tan(x+y), let
 *                   3      2      2       2       2
 *              r = x *(T2+x *(T3+x *(...+x *(T12+x *T13))))
 *         then
 *                                  3    2
 *              tan(x+y) = x + (T1*x + (x *(r+y)+y))
 *
 *      4. For x in [0.67434,pi/4],  let y = pi/4 - x, then
 *              tan(x) = tan(pi/4-y) = (1-tan(y))/(1+tan(y))
 *                     = 1 - 2*(tan(y) - (tan(y)^2)/(1+tan(y)))
 */


static const double T[] = {
             3.33333333333334091986e-01, /* 3FD55555, 55555563 */
             1.33333333333201242699e-01, /* 3FC11111, 1110FE7A */
             5.39682539762260521377e-02, /* 3FABA1BA, 1BB341FE */
             2.18694882948595424599e-02, /* 3F9664F4, 8406D637 */
             8.86323982359930005737e-03, /* 3F8226E3, E96E8493 */
             3.59207910759131235356e-03, /* 3F6D6D22, C9560328 */
             1.45620945432529025516e-03, /* 3F57DBC8, FEE08315 */
             5.88041240820264096874e-04, /* 3F4344D8, F2F26501 */
             2.46463134818469906812e-04, /* 3F3026F7, 1A8D1068 */
             7.81794442939557092300e-05, /* 3F147E88, A03792A6 */
             7.14072491382608190305e-05, /* 3F12B80F, 32F0A7E9 */
            -1.85586374855275456654e-05, /* BEF375CB, DB605373 */
             2.59073051863633712884e-05, /* 3EFB2A70, 74BF7AD4 */
},
pio4 =       7.85398163397448278999e-01, /* 3FE921FB, 54442D18 */
pio4lo =     3.06161699786838301793e-17; /* 3C81A626, 33145C07 */

double __tan(double x, double y, int odd)
{
	double_t z, r, v, w, s, a;
	double w0, a0;
	uint32_t hx;
	int big, sign;

	GET_HIGH_WORD(hx,x);
	big = (hx&0x7fffffff) >= 0x3FE59428; /* |x| >= 0.6744 */
	if (big) {
		sign = hx>>31;
		if (sign) {
			x = -x;
			y = -y;
		}
		x = (pio4 - x) + (pio4lo - y);
		y = 0.0;
	}
	z = x * x;
	w = z * z;
	/*
	 * Break x^5*(T[1]+x^2*T[2]+...) into
	 * x^5(T[1]+x^4*T[3]+...+x^20*T[11]) +
	 * x^5(x^2*(T[2]+x^4*T[4]+...+x^22*[T12]))
	 */
	r = T[1] + w*(T[3] + w*(T[5] + w*(T[7] + w*(T[9] + w*T[11]))));
	v = z*(T[2] + w*(T[4] + w*(T[6] + w*(T[8] + w*(T[10] + w*T[12])))));
	s = z * x;
	r = y + z*(s*(r + v) + y) + s*T[0];
	w = x + r;
	if (big) {
		s = 1 - 2*odd;
		v = s - 2.0 * (x + (r - w*w/(w + s)));
		return sign ? -v : v;
	}
	if (!odd)
		return w;
	/* -1.0/(x+r) has up to 2ulp error, so compute it accurately */
	w0 = w;
	SET_LOW_WORD(w0, 0);
	v = r - (w0 - x);       /* w0+v = r+x */
	a0 = a = -1.0 / w;
	SET_LOW_WORD(a0, 0);
	return a0 + a*(1.0 + a0*w0 + a0*v);
}

#undef T
#undef pio4
#undef pio4lo
/* ===== expm1.c ===== */
#define Q1 fd_expm1_Q1
#define Q2 fd_expm1_Q2
#define Q3 fd_expm1_Q3
#define Q4 fd_expm1_Q4
#define Q5 fd_expm1_Q5
#define invln2 fd_expm1_invln2
#define ln2_hi fd_expm1_ln2_hi
#define ln2_lo fd_expm1_ln2_lo
#define o_threshold fd_expm1_o_threshold
/* origin: FreeBSD /usr/src/lib/msun/src/s_expm1.c */
/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */
/* expm1(x)
 * Returns exp(x)-1, the exponential of x minus 1.
 *
 * Method
 *   1. Argument reduction:
 *      Given x, find r and integer k such that
 *
 *               x = k*ln2 + r,  |r| <= 0.5*ln2 ~ 0.34658
 *
 *      Here a correction term c will be computed to compensate
 *      the error in r when rounded to a floating-point number.
 *
 *   2. Approximating expm1(r) by a special rational function on
 *      the interval [0,0.34658]:
 *      Since
 *          r*(exp(r)+1)/(exp(r)-1) = 2+ r^2/6 - r^4/360 + ...
 *      we define R1(r*r) by
 *          r*(exp(r)+1)/(exp(r)-1) = 2+ r^2/6 * R1(r*r)
 *      That is,
 *          R1(r**2) = 6/r *((exp(r)+1)/(exp(r)-1) - 2/r)
 *                   = 6/r * ( 1 + 2.0*(1/(exp(r)-1) - 1/r))
 *                   = 1 - r^2/60 + r^4/2520 - r^6/100800 + ...
 *      We use a special Remez algorithm on [0,0.347] to generate
 *      a polynomial of degree 5 in r*r to approximate R1. The
 *      maximum error of this polynomial approximation is bounded
 *      by 2**-61. In other words,
 *          R1(z) ~ 1.0 + Q1*z + Q2*z**2 + Q3*z**3 + Q4*z**4 + Q5*z**5
 *      where   Q1  =  -1.6666666666666567384E-2,
 *              Q2  =   3.9682539681370365873E-4,
 *              Q3  =  -9.9206344733435987357E-6,
 *              Q4  =   2.5051361420808517002E-7,
 *              Q5  =  -6.2843505682382617102E-9;
 *              z   =  r*r,
 *      with error bounded by
 *          |                  5           |     -61
 *          | 1.0+Q1*z+...+Q5*z   -  R1(z) | <= 2
 *          |                              |
 *
 *      expm1(r) = exp(r)-1 is then computed by the following
 *      specific way which minimize the accumulation rounding error:
 *                             2     3
 *                            r     r    [ 3 - (R1 + R1*r/2)  ]
 *            expm1(r) = r + --- + --- * [--------------------]
 *                            2     2    [ 6 - r*(3 - R1*r/2) ]
 *
 *      To compensate the error in the argument reduction, we use
 *              expm1(r+c) = expm1(r) + c + expm1(r)*c
 *                         ~ expm1(r) + c + r*c
 *      Thus c+r*c will be added in as the correction terms for
 *      expm1(r+c). Now rearrange the term to avoid optimization
 *      screw up:
 *                      (      2                                    2 )
 *                      ({  ( r    [ R1 -  (3 - R1*r/2) ]  )  }    r  )
 *       expm1(r+c)~r - ({r*(--- * [--------------------]-c)-c} - --- )
 *                      ({  ( 2    [ 6 - r*(3 - R1*r/2) ]  )  }    2  )
 *                      (                                             )
 *
 *                 = r - E
 *   3. Scale back to obtain expm1(x):
 *      From step 1, we have
 *         expm1(x) = either 2^k*[expm1(r)+1] - 1
 *                  = or     2^k*[expm1(r) + (1-2^-k)]
 *   4. Implementation notes:
 *      (A). To save one multiplication, we scale the coefficient Qi
 *           to Qi*2^i, and replace z by (x^2)/2.
 *      (B). To achieve maximum accuracy, we compute expm1(x) by
 *        (i)   if x < -56*ln2, return -1.0, (raise inexact if x!=inf)
 *        (ii)  if k=0, return r-E
 *        (iii) if k=-1, return 0.5*(r-E)-0.5
 *        (iv)  if k=1 if r < -0.25, return 2*((r+0.5)- E)
 *                     else          return  1.0+2.0*(r-E);
 *        (v)   if (k<-2||k>56) return 2^k(1-(E-r)) - 1 (or exp(x)-1)
 *        (vi)  if k <= 20, return 2^k((1-2^-k)-(E-r)), else
 *        (vii) return 2^k(1-((E+2^-k)-r))
 *
 * Special cases:
 *      expm1(INF) is INF, expm1(NaN) is NaN;
 *      expm1(-INF) is -1, and
 *      for finite argument, only expm1(0)=0 is exact.
 *
 * Accuracy:
 *      according to an error analysis, the error is always less than
 *      1 ulp (unit in the last place).
 *
 * Misc. info.
 *      For IEEE double
 *          if x >  7.09782712893383973096e+02 then expm1(x) overflow
 *
 * Constants:
 * The hexadecimal values are the intended ones for the following
 * constants. The decimal values may be used, provided that the
 * compiler will convert from decimal to binary accurately enough
 * to produce the hexadecimal values shown.
 */


static const double
o_threshold = 7.09782712893383973096e+02, /* 0x40862E42, 0xFEFA39EF */
ln2_hi      = 6.93147180369123816490e-01, /* 0x3fe62e42, 0xfee00000 */
ln2_lo      = 1.90821492927058770002e-10, /* 0x3dea39ef, 0x35793c76 */
invln2      = 1.44269504088896338700e+00, /* 0x3ff71547, 0x652b82fe */
/* Scaled Q's: Qn_here = 2**n * Qn_above, for R(2*z) where z = hxs = x*x/2: */
Q1 = -3.33333333333331316428e-02, /* BFA11111 111110F4 */
Q2 =  1.58730158725481460165e-03, /* 3F5A01A0 19FE5585 */
Q3 = -7.93650757867487942473e-05, /* BF14CE19 9EAADBB7 */
Q4 =  4.00821782732936239552e-06, /* 3ED0CFCA 86E65239 */
Q5 = -2.01099218183624371326e-07; /* BE8AFDB7 6E09C32D */

double expm1(double x)
{
	double_t y,hi,lo,c,t,e,hxs,hfx,r1,twopk;
	union {double f; uint64_t i;} u = {x};
	uint32_t hx = u.i>>32 & 0x7fffffff;
	int k, sign = u.i>>63;

	/* filter out huge and non-finite argument */
	if (hx >= 0x4043687A) {  /* if |x|>=56*ln2 */
		if (isnan(x))
			return x;
		if (sign)
			return -1;
		if (x > o_threshold) {
			x *= 0x1p1023;
			return x;
		}
	}

	/* argument reduction */
	if (hx > 0x3fd62e42) {  /* if  |x| > 0.5 ln2 */
		if (hx < 0x3FF0A2B2) {  /* and |x| < 1.5 ln2 */
			if (!sign) {
				hi = x - ln2_hi;
				lo = ln2_lo;
				k =  1;
			} else {
				hi = x + ln2_hi;
				lo = -ln2_lo;
				k = -1;
			}
		} else {
			k  = invln2*x + (sign ? -0.5 : 0.5);
			t  = k;
			hi = x - t*ln2_hi;  /* t*ln2_hi is exact here */
			lo = t*ln2_lo;
		}
		x = hi-lo;
		c = (hi-x)-lo;
	} else if (hx < 0x3c900000) {  /* |x| < 2**-54, return x */
		if (hx < 0x00100000)
			FORCE_EVAL((float)x);
		return x;
	} else
		k = 0;

	/* x is now in primary range */
	hfx = 0.5*x;
	hxs = x*hfx;
	r1 = 1.0+hxs*(Q1+hxs*(Q2+hxs*(Q3+hxs*(Q4+hxs*Q5))));
	t  = 3.0-r1*hfx;
	e  = hxs*((r1-t)/(6.0 - x*t));
	if (k == 0)   /* c is 0 */
		return x - (x*e-hxs);
	e  = x*(e-c) - c;
	e -= hxs;
	/* exp(x) ~ 2^k (x_reduced - e + 1) */
	if (k == -1)
		return 0.5*(x-e) - 0.5;
	if (k == 1) {
		if (x < -0.25)
			return -2.0*(e-(x+0.5));
		return 1.0+2.0*(x-e);
	}
	u.i = (uint64_t)(0x3ff + k)<<52;  /* 2^k */
	twopk = u.f;
	if (k < 0 || k > 56) {  /* suffice to return exp(x)-1 */
		y = x - e + 1.0;
		if (k == 1024)
			y = y*2.0*0x1p1023;
		else
			y = y*twopk;
		return y - 1.0;
	}
	u.i = (uint64_t)(0x3ff - k)<<52;  /* 2^-k */
	if (k < 20)
		y = (x-e+(1-u.f))*twopk;
	else
		y = (x-(e+u.f)+1)*twopk;
	return y;
}

#undef Q1
#undef Q2
#undef Q3
#undef Q4
#undef Q5
#undef invln2
#undef ln2_hi
#undef ln2_lo
#undef o_threshold

/* Sun fdlibm kernels and log1p, in the form V8's base/ieee754.cc carries them. */
static const double
  S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
double scr_fd___sin(double x, double y, int iy) {
  double z, r, v; int32_t ix;
  GET_HIGH_WORD(ix, x); ix &= 0x7fffffff;
  if (ix < 0x3e400000) { if ((int)x == 0) return x; }
  z = x * x; v = z * x;
  r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy == 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
static const double
  C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
double scr_fd___cos(double x, double y) {
  double a, hz, z, r, qx = 0; int32_t ix;
  GET_HIGH_WORD(ix, x); ix &= 0x7fffffff;
  if (ix < 0x3e400000) { if ((int)x == 0) return 1.0; }
  z = x * x;
  r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3FD33333) return 1.0 - (0.5 * z - (z * r - x * y));
  if (ix > 0x3fe90000) qx = 0.28125; else INSERT_WORDS(qx, ix - 0x00200000, 0);
  hz = 0.5 * z - qx; a = 1.0 - qx;
  return a - (hz - (z * r - x * y));
}
static const double
  ln2_hi_ = 6.93147180369123816490e-01, ln2_lo_ = 1.90821492927058770002e-10, two54_ = 1.80143985094819840000e+16,
  Lp1 = 6.666666666666735130e-01, Lp2 = 3.999999999940941908e-01, Lp3 = 2.857142874366239149e-01, Lp4 = 2.222219843214978396e-01,
  Lp5 = 1.818357216161805012e-01, Lp6 = 1.531383769920937332e-01, Lp7 = 1.479819860511658591e-01;
double scr_fd_log1p(double x) {
  double hfsq, f = 0, c = 0, s, z, R, u; int32_t k, hx, hu = 0, ax;
  GET_HIGH_WORD(hx, x); ax = hx & 0x7fffffff;
  k = 1;
  if (hx < 0x3FDA827A) {
    if (ax >= 0x3ff00000) { if (x == -1.0) return -two54_ / 0.0; return (x - x) / (x - x); }
    if (ax < 0x3e200000) { if (two54_ + x > 0.0 && ax < 0x3c900000) return x; return x - x * x * 0.5; }
    if (hx > 0 || hx <= ((int32_t)0xbfd2bec4)) { k = 0; f = x; hu = 1; }
  }
  if (hx >= 0x7ff00000) return x + x;
  if (k != 0) {
    if (hx < 0x43400000) { u = 1.0 + x; GET_HIGH_WORD(hu, u); k = (hu >> 20) - 1023; c = (k > 0) ? 1.0 - (u - x) : x - (u - 1.0); c /= u; }
    else { u = x; GET_HIGH_WORD(hu, u); k = (hu >> 20) - 1023; c = 0; }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) { SET_HIGH_WORD(u, hu | 0x3ff00000); }
    else { k += 1; SET_HIGH_WORD(u, hu | 0x3fe00000); hu = (0x00100000 - hu) >> 2; }
    f = u - 1.0;
  }
  hfsq = 0.5 * f * f;
  if (hu == 0) {
    if (f == 0.0) { if (k == 0) return 0.0; c += k * ln2_lo_; return k * ln2_hi_ + c; }
    R = hfsq * (1.0 - 0.66666666666666666 * f);
    if (k == 0) return f - R;
    return k * ln2_hi_ - ((R - (k * ln2_lo_ + c)) - f);
  }
  s = f / (2.0 + f); z = s * s;
  R = z * (Lp1 + z * (Lp2 + z * (Lp3 + z * (Lp4 + z * (Lp5 + z * (Lp6 + z * Lp7))))));
  if (k == 0) return f - (hfsq - s * (hfsq + R));
  return k * ln2_hi_ - ((hfsq - (s * (hfsq + R) + (k * ln2_lo_ + c))) - f);
}

double scr_fd_sin(double x) {
#ifdef SCR_FD_PLANT_LIBM_SIN
  return sin(x); /* the planted defect: the platform libm stands in for V8's routine (the row that checks the bits must see it) */
#endif
  double y[2]; uint32_t ix; unsigned n;
  GET_HIGH_WORD(ix, x); ix &= 0x7fffffff;
  if (ix <= 0x3fe921fb) { if (ix < 0x3e500000) { FORCE_EVAL(ix < 0x00100000 ? x/0x1p120f : x+0x1p120f); return x; } return scr_fd___sin(x, 0.0, 0); }
  if (ix >= 0x7ff00000) return x - x;
  n = scr_fd___rem_pio2(x, y);
  switch (n&3) { case 0: return scr_fd___sin(y[0], y[1], 1); case 1: return scr_fd___cos(y[0], y[1]); case 2: return -scr_fd___sin(y[0], y[1], 1); default: return -scr_fd___cos(y[0], y[1]); }
}
double scr_fd_cos(double x) {
  double y[2]; uint32_t ix; unsigned n;
  GET_HIGH_WORD(ix, x); ix &= 0x7fffffff;
  if (ix <= 0x3fe921fb) { if (ix < 0x3e46a09e) { FORCE_EVAL(x+0x1p120f); return 1.0; } return scr_fd___cos(x, 0); }
  if (ix >= 0x7ff00000) return x - x;
  n = scr_fd___rem_pio2(x, y);
  switch (n&3) { case 0: return scr_fd___cos(y[0], y[1]); case 1: return -scr_fd___sin(y[0], y[1], 1); case 2: return -scr_fd___cos(y[0], y[1]); default: return scr_fd___sin(y[0], y[1], 1); }
}
double scr_fd_tan(double x) {
  double y[2]; uint32_t ix; unsigned n;
  GET_HIGH_WORD(ix, x); ix &= 0x7fffffff;
  if (ix <= 0x3fe921fb) { if (ix < 0x3e400000) { FORCE_EVAL(ix < 0x00100000 ? x/0x1p120f : x+0x1p120f); return x; } return scr_fd___tan(x, 0.0, 0); }
  if (ix >= 0x7ff00000) return x - x;
  n = scr_fd___rem_pio2(x, y);
  return scr_fd___tan(y[0], y[1], n&1);
}

/* batch 2: Sun fdlibm routines, in the form V8's base/ieee754.cc carries them. */
static const double huge_ = 1.0e300, tiny_ = 1.0e-300, vzero_ = 0.0;
/* ---- atan ---- */
static const double atanhi_[] = { 4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00 };
static const double atanlo_[] = { 2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17 };
static const double aT_[] = { 3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02 };
double scr_fd_atan(double x) {
  double w, s1, s2, z; int32_t ix, hx, id;
  GET_HIGH_WORD(hx, x); ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    uint32_t low; GET_LOW_WORD(low, x);
    if (ix > 0x7ff00000 || (ix == 0x7ff00000 && low != 0)) return x + x;
    if (hx > 0) return atanhi_[3] + *(volatile double *)&atanlo_[3];
    return -atanhi_[3] - *(volatile double *)&atanlo_[3];
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) { if (huge_ + x > 1.0) return x; }
    id = -1;
  } else {
    x = fabs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); }
      else { id = 1; x = (x - 1.0) / (x + 1.0); }
    } else {
      if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); }
      else { id = 3; x = -1.0 / x; }
    }
  }
  z = x * x; w = z * z;
  s1 = z * (aT_[0] + w * (aT_[2] + w * (aT_[4] + w * (aT_[6] + w * (aT_[8] + w * aT_[10])))));
  s2 = w * (aT_[1] + w * (aT_[3] + w * (aT_[5] + w * (aT_[7] + w * aT_[9]))));
  if (id < 0) return x - x * (s1 + s2);
  z = atanhi_[id] - ((x * (s1 + s2) - atanlo_[id]) - x);
  return (hx < 0) ? -z : z;
}
/* ---- asin / acos ---- */
static const double
  pio2_hi_ = 1.57079632679489655800e+00, pio2_lo_ = 6.12323399573676603587e-17, pio4_hi_ = 7.85398163397448278999e-01, pi_ = 3.14159265358979311600e+00,
  pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01, pS3 = -4.00555345006794114027e-02,
  pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05, qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00,
  qS3 = -6.88283971605453293030e-01, qS4 = 7.70381505559019352791e-02;
double scr_fd_asin(double x) {
  double t = 0, w, p, q, c, r, s; int32_t hx, ix;
  GET_HIGH_WORD(hx, x); ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    uint32_t lx; GET_LOW_WORD(lx, x);
    if (((ix - 0x3ff00000) | lx) == 0) return x * pio2_hi_ + x * pio2_lo_;
    return (x - x) / (x - x);
  } else if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) { if (huge_ + x > 1.0) return x; }
    else t = x * x;
    p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
    q = 1.0 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
    w = p / q;
    return x + x * w;
  }
  w = 1.0 - fabs(x); t = w * 0.5;
  p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
  q = 1.0 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
  s = sqrt(t);
  if (ix >= 0x3FEF3333) { w = p / q; t = pio2_hi_ - (2.0 * (s + s * w) - pio2_lo_); }
  else { w = s; SET_LOW_WORD(w, 0); c = (t - w * w) / (s + w); r = p / q; p = 2.0 * s * r - (pio2_lo_ - 2.0 * c); q = pio4_hi_ - 2.0 * w; t = pio4_hi_ - (p - q); }
  return (hx > 0) ? t : -t;
}
double scr_fd_acos(double x) {
  double z, p, q, r, w, s, c, df; int32_t hx, ix;
  GET_HIGH_WORD(hx, x); ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    uint32_t lx; GET_LOW_WORD(lx, x);
    if (((ix - 0x3ff00000) | lx) == 0) { if (hx > 0) return 0.0; return pi_ + 2.0 * pio2_lo_; }
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return pio2_hi_ + pio2_lo_;
    z = x * x;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    r = p / q;
    return pio2_hi_ - (x - (pio2_lo_ - x * r));
  } else if (hx < 0) {
    z = (1.0 + x) * 0.5;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    s = sqrt(z); r = p / q; w = r * s - pio2_lo_;
    return pi_ - 2.0 * (s + w);
  }
  z = (1.0 - x) * 0.5; s = sqrt(z); df = s; SET_LOW_WORD(df, 0);
  c = (z - df * df) / (s + df);
  p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
  q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
  r = p / q; w = r * s + c;
  return 2.0 * (df + w);
}

/* batch 3: exp, log family, hyperbolics, cbrt, atan2 */
static const double
  ex_halF[2] = { 0.5, -0.5 }, ex_o_threshold = 7.09782712893383973096e+02, ex_u_threshold = -7.45133219101941108420e+02,
  ex_ln2HI[2] = { 6.93147180369123816490e-01, -6.93147180369123816490e-01 }, ex_ln2LO[2] = { 1.90821492927058770002e-10, -1.90821492927058770002e-10 },
  ex_invln2 = 1.44269504088896338700e+00, ex_P1 = 1.66666666666666019037e-01, ex_P2 = -2.77777777770155933842e-03, ex_P3 = 6.61375632143793436117e-05,
  ex_P4 = -1.65339022054652515390e-06, ex_P5 = 4.13813679705723846039e-08, ex_E = 2.718281828459045, ex_huge = 1.0e+300, ex_twom1000 = 9.33263618503218878990e-302;
double scr_fd_exp(double x) {
  double y, hi = 0.0, lo = 0.0, c, t, twopk; int32_t k = 0, xsb; uint32_t hx;
  GET_HIGH_WORD(hx, x); xsb = (hx >> 31) & 1; hx &= 0x7fffffff;
  if (hx >= 0x40862E42) {
    if (hx >= 0x7ff00000) {
      uint32_t lx; GET_LOW_WORD(lx, x);
      if (((hx & 0xfffff) | lx) != 0) return x + x;
      return (xsb == 0) ? x : 0.0;
    }
    if (x > ex_o_threshold) return ex_huge * ex_huge;
    if (x < ex_u_threshold) return ex_twom1000 * ex_twom1000;
  }
  if (hx > 0x3fd62e42) {
    if (hx < 0x3FF0A2B2) {
      if (x == 1.0) return ex_E;
      hi = x - ex_ln2HI[xsb]; lo = ex_ln2LO[xsb]; k = 1 - xsb - xsb;
    } else {
      k = (int)(ex_invln2 * x + ex_halF[xsb]); t = k;
      hi = x - t * ex_ln2HI[0]; lo = t * ex_ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    if (ex_huge + x > 1.0) return 1.0 + x;
  } else k = 0;
  t = x * x;
  if (k >= -1021) { INSERT_WORDS(twopk, 0x3ff00000 + ((uint32_t)k << 20), 0); }
  else { INSERT_WORDS(twopk, 0x3ff00000 + ((uint32_t)(k + 1000) << 20), 0); }
  c = x - t * (ex_P1 + t * (ex_P2 + t * (ex_P3 + t * (ex_P4 + t * ex_P5))));
  if (k == 0) return 1.0 - ((x * c) / (c - 2.0) - x);
  y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    if (k == 1024) return y * 2.0 * 8.98846567431157953865e+307;
    return y * twopk;
  }
  return y * twopk * ex_twom1000 * 1.0;
}
/* the shared constants of the log family */
static const double
  lg_ln2_hi = 6.93147180369123816490e-01, lg_ln2_lo = 1.90821492927058770002e-10, lg_two54 = 1.80143985094819840000e+16,
  Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01,
  Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
double scr_fd_log(double x) {
  double hfsq, f, s, z, R, w, t1, t2, dk; int32_t k, hx, i, j; uint32_t lx;
  EXTRACT_WORDS(hx, lx, x); k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -lg_two54 / vzero_;
    if (hx < 0) return (x - x) / vzero_;
    k -= 54; x *= lg_two54; GET_HIGH_WORD(hx, x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023; hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  SET_HIGH_WORD(x, hx | (i ^ 0x3ff00000));
  k += (i >> 20); f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f == 0.0) { if (k == 0) return 0.0; dk = (double)k; return dk * lg_ln2_hi + dk * lg_ln2_lo; }
    R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k == 0) return f - R;
    dk = (double)k; return dk * lg_ln2_hi - ((R - dk * lg_ln2_lo) - f);
  }
  s = f / (2.0 + f); dk = (double)k; z = s * s; i = hx - 0x6147a; w = z * z; j = 0x6b851 - hx;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6)); t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j; R = t2 + t1;
  if (i > 0) {
    hfsq = 0.5 * f * f;
    if (k == 0) return f - (hfsq - s * (hfsq + R));
    return dk * lg_ln2_hi - ((hfsq - (s * (hfsq + R) + dk * lg_ln2_lo)) - f);
  }
  if (k == 0) return f - s * (f - R);
  return dk * lg_ln2_hi - ((s * (f - R) - dk * lg_ln2_lo) - f);
}
static double fd_k_log1p(double f) {
  double hfsq, s, z, R, w, t1, t2;
  s = f / (2.0 + f); z = s * s; w = z * z;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6)); t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  R = t2 + t1; hfsq = 0.5 * f * f;
  return s * (hfsq + R);
}
static const double ivln2hi_ = 1.44269504072144627571e+00, ivln2lo_ = 1.67517131648865118353e-10;
double scr_fd_log2(double x) {
  double f, hfsq, hi, lo, r, val_hi, val_lo, w, y; int32_t i, k, hx; uint32_t lx;
  EXTRACT_WORDS(hx, lx, x); k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -lg_two54 / vzero_;
    if (hx < 0) return (x - x) / vzero_;
    k -= 54; x *= lg_two54; GET_HIGH_WORD(hx, x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx == 0x3ff00000 && lx == 0) return 0.0;
  k += (hx >> 20) - 1023; hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  SET_HIGH_WORD(x, hx | (i ^ 0x3ff00000));
  k += (i >> 20); y = (double)k;
  f = x - 1.0; hfsq = 0.5 * f * f; r = fd_k_log1p(f);
  hi = f - hfsq; SET_LOW_WORD(hi, 0);
  lo = (f - hi) - hfsq + r;
  val_hi = hi * ivln2hi_; val_lo = (lo + hi) * ivln2lo_ + lo * ivln2hi_;
  w = y + val_hi; val_lo += (y - w) + val_hi; val_hi = w;
  return val_lo + val_hi;
}
static const double ivln10_ = 4.34294481903251816668e-01, log10_2hi_ = 3.01029995663611771306e-01, log10_2lo_ = 3.69423907715893078616e-13;
double scr_fd_log10(double x) {
  double y, z; int32_t i, k, hx; uint32_t lx;
  EXTRACT_WORDS(hx, lx, x); k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -lg_two54 / vzero_;
    if (hx < 0) return (x - x) / vzero_;
    k -= 54; x *= lg_two54; GET_HIGH_WORD(hx, x); GET_LOW_WORD(lx, x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx == 0x3ff00000 && lx == 0) return 0.0;
  k += (hx >> 20) - 1023;
  i = ((uint32_t)k & 0x80000000) >> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  y = (double)(k + i);
  SET_HIGH_WORD(x, hx); SET_LOW_WORD(x, lx);
  z = y * log10_2lo_ + ivln10_ * scr_fd_log(x);
  return z + y * log10_2hi_;
}
/* ---- hyperbolics (V8's forms) ---- */
double scr_fd_sinh(double x) {
  static const double KSINH_OVERFLOW = 710.4758600739439, TWO_M28 = 3.725290298461914e-9, LOG_MAXD = 709.7822265625, shuge = 1.0e307;
  double h = (x < 0) ? -0.5 : 0.5, ax = fabs(x);
  if (ax < 22) {
    if (ax < TWO_M28) return x;
    double t = scr_fd_expm1(ax);
    if (ax < 1) return h * (2.0 * t - t * t / (t + 1.0));
    return h * (t + t / (t + 1.0));
  }
  if (ax < LOG_MAXD) return h * scr_fd_exp(ax);
  if (ax <= KSINH_OVERFLOW) { double w = scr_fd_exp(0.5 * ax); double t = h * w; return t * w; }
  return x * shuge;
}
double scr_fd_cosh(double x) {
  static const double KCOSH_OVERFLOW = 710.4758600739439;
  int32_t ix; GET_HIGH_WORD(ix, x); ix &= 0x7fffffff;
  if (ix < 0x3fd62e43) { double t = scr_fd_expm1(fabs(x)); double w = 1.0 + t; if (ix < 0x3c800000) return w; return 1.0 + (t * t) / (w + w); }
  if (ix < 0x40360000) { double t = scr_fd_exp(fabs(x)); return 0.5 * t + 0.5 / t; }
  if (ix < 0x40862e42) return 0.5 * scr_fd_exp(fabs(x));
  if (fabs(x) <= KCOSH_OVERFLOW) { double w = scr_fd_exp(0.5 * fabs(x)); double t = 0.5 * w; return t * w; }
  if (ix >= 0x7ff00000) return x * x;
  return 1.0e300 * 1.0e300;
}
double scr_fd_tanh(double x) {
  double t, z; int32_t jx, ix;
  GET_HIGH_WORD(jx, x); ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) { if (jx >= 0) return 1.0 / x + 1.0; return 1.0 / x - 1.0; }
  if (ix < 0x40360000) {
    if (ix < 0x3e300000) { if (huge_ + x > 1.0) return x; }
    if (ix >= 0x3ff00000) { t = scr_fd_expm1(2.0 * fabs(x)); z = 1.0 - 2.0 / (t + 2.0); }
    else { t = scr_fd_expm1(-2.0 * fabs(x)); z = -t / (t + 2.0); }
  } else z = 1.0 - tiny_;
  return (jx >= 0) ? z : -z;
}
static const double ln2_ = 6.93147180559945286227e-01;
double scr_fd_asinh(double x) {
  double t, w; int32_t hx, ix;
  GET_HIGH_WORD(hx, x); ix = hx & 0x7fffffff;
  if (ix >= 0x7ff00000) return x + x;
  if (ix < 0x3e300000) { if (huge_ + x > 1.0) return x; }
  if (ix > 0x41b00000) w = scr_fd_log(fabs(x)) + ln2_;
  else if (ix > 0x40000000) { t = fabs(x); w = scr_fd_log(2.0 * t + 1.0 / (sqrt(x * x + 1.0) + t)); }
  else { t = x * x; w = scr_fd_log1p(fabs(x) + t / (1.0 + sqrt(1.0 + t))); }
  return (hx > 0) ? w : -w;
}
double scr_fd_acosh(double x) {
  double t; int32_t hx; uint32_t lx;
  EXTRACT_WORDS(hx, lx, x);
  if (hx < 0x3ff00000) return (x - x) / (x - x);
  if (hx >= 0x41b00000) { if (hx >= 0x7ff00000) return x + x; return scr_fd_log(x) + ln2_; }
  if (((hx - 0x3ff00000) | lx) == 0) return 0.0;
  if (hx > 0x40000000) { t = x * x; return scr_fd_log(2.0 * x - 1.0 / (x + sqrt(t - 1.0))); }
  t = x - 1.0; return scr_fd_log1p(t + sqrt(2.0 * t + t * t));
}
double scr_fd_atanh(double x) {
  double t; int32_t hx, ix; uint32_t lx;
  EXTRACT_WORDS(hx, lx, x); ix = hx & 0x7fffffff;
  if ((ix | ((lx | (-lx)) >> 31)) > 0x3ff00000) return (x - x) / (x - x);
  if (ix == 0x3ff00000) return x / vzero_;
  if (ix < 0x3e300000 && (huge_ + x) > 0.0) return x;
  SET_HIGH_WORD(x, ix);
  if (ix < 0x3fe00000) { t = x + x; t = 0.5 * scr_fd_log1p(t + t * x / (1.0 - x)); }
  else t = 0.5 * scr_fd_log1p((x + x) / (1.0 - x));
  return (hx >= 0) ? t : -t;
}
/* ---- cbrt (FreeBSD s_cbrt.c, as V8 carries it) ---- */
double scr_fd_cbrt(double x) {
  static const uint32_t B1 = 715094163, B2 = 696219795;
  static const double P0 = 1.87595182427177009643, P1 = -1.88497979543377169875, P2 = 1.621429720105354466140, P3 = -0.758397934778766047437, P4 = 0.145996192886612446982;
  int32_t hx; double r, s, t = 0.0, w; uint32_t sign, high, low;
  EXTRACT_WORDS(hx, low, x); sign = hx & 0x80000000; hx ^= sign;
  if (hx >= 0x7ff00000) return x + x;
  if (hx < 0x00100000) {
    if ((hx | low) == 0) return x;
    SET_HIGH_WORD(t, 0x43500000); t *= x; GET_HIGH_WORD(high, t);
    INSERT_WORDS(t, sign | ((high & 0x7fffffff) / 3 + B2), 0);
  } else INSERT_WORDS(t, sign | (hx / 3 + B1), 0);
  r = (t * t) * (t / x);
  t = t * ((P0 + r * (P1 + r * P2)) + ((r * r) * r) * (P3 + r * P4));
  { uint64_t u = asuint64(t); u = (u + 0x80000000ULL) & 0xffffffffc0000000ULL; t = asdouble(u); }
  s = t * t; r = x / s; w = t + t; r = (r - t) / (w + r); t = t + t * r;
  return t;
}
/* ---- atan2 (Sun e_atan2.c) ---- */
static const double a2_pi_o_4 = 7.8539816339744827900E-01, a2_pi_o_2 = 1.5707963267948965580E+00, a2_pi = 3.1415926535897931160E+00, a2_pi_lo = 1.2246467991473531772E-16;
double scr_fd_atan2(double y, double x) {
  double z; int32_t k, m, hx, hy, ix, iy; uint32_t lx, ly;
  EXTRACT_WORDS(hx, lx, x); ix = hx & 0x7fffffff;
  EXTRACT_WORDS(hy, ly, y); iy = hy & 0x7fffffff;
  if (((ix | ((lx | -lx) >> 31)) > 0x7ff00000) || ((iy | ((ly | -ly) >> 31)) > 0x7ff00000)) return x + y;
  if (((hx - 0x3ff00000) | lx) == 0) return scr_fd_atan(y);
  m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) == 0) {
    switch (m) { case 0: case 1: return y; case 2: return a2_pi + tiny_; case 3: return -a2_pi - tiny_; }
  }
  if ((ix | lx) == 0) return (hy < 0) ? -a2_pi_o_2 - tiny_ : a2_pi_o_2 + tiny_;
  if (ix == 0x7ff00000) {
    if (iy == 0x7ff00000) {
      switch (m) { case 0: return a2_pi_o_4 + tiny_; case 1: return -a2_pi_o_4 - tiny_; case 2: return 3.0 * a2_pi_o_4 + tiny_; case 3: return -3.0 * a2_pi_o_4 - tiny_; }
    } else {
      switch (m) { case 0: return 0.0; case 1: return -0.0; case 2: return a2_pi + tiny_; case 3: return -a2_pi - tiny_; }
    }
  }
  if (iy == 0x7ff00000) return (hy < 0) ? -a2_pi_o_2 - tiny_ : a2_pi_o_2 + tiny_;
  k = (iy - ix) >> 20;
  if (k > 60) { z = a2_pi_o_2 + 0.5 * a2_pi_lo; m &= 1; }
  else if (hx < 0 && k < -60) z = 0.0;
  else z = scr_fd_atan(fabs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return a2_pi - (z - a2_pi_lo);
    default: return (z - a2_pi_lo) - a2_pi;
  }
}

/* batch 4: pow (Sun e_pow.c as V8 carries it) and hypot (V8's scaled Kahan sum) */
static const double
  pw_bp[] = { 1.0, 1.5 }, pw_dp_h[] = { 0.0, 5.84962487220764160156e-01 }, pw_dp_l[] = { 0.0, 1.35003920212974897128e-08 },
  pw_two53 = 9007199254740992.0, pw_huge = 1.0e300, pw_tiny = 1.0e-300,
  pw_L1 = 5.99999999999994648725e-01, pw_L2 = 4.28571428578550184252e-01, pw_L3 = 3.33333329818377432918e-01, pw_L4 = 2.72728123808534006489e-01,
  pw_L5 = 2.30660745775561754067e-01, pw_L6 = 2.06975017800338417784e-01, pw_P1 = 1.66666666666666019037e-01, pw_P2 = -2.77777777770155933842e-03,
  pw_P3 = 6.61375632143793436117e-05, pw_P4 = -1.65339022054652515390e-06, pw_P5 = 4.13813679705723846039e-08, pw_lg2 = 6.93147180559945286227e-01,
  pw_lg2_h = 6.93147182464599609375e-01, pw_lg2_l = -1.90465429995776804525e-09, pw_ovt = 8.0085662595372944372e-17, pw_cp = 9.61796693925975554329e-01,
  pw_cp_h = 9.61796700954437255859e-01, pw_cp_l = -7.02846165095275826516e-09, pw_ivln2 = 1.44269504088896338700e+00,
  pw_ivln2_h = 1.44269502162933349609e+00, pw_ivln2_l = 1.92596299112661746887e-08;
double scr_fd_pow(double x, double y) {
  double z, ax, z_h, z_l, p_h, p_l, y1, t1, t2, r, s, t, u, v, w; int32_t i, j, k, yisint, n, hx, hy, ix, iy; uint32_t lx, ly;
  EXTRACT_WORDS(hx, lx, x); EXTRACT_WORDS(hy, ly, y);
  ix = hx & 0x7fffffff; iy = hy & 0x7fffffff;
  if ((iy | ly) == 0) return 1.0;
  if (ix > 0x7ff00000 || ((ix == 0x7ff00000) && (lx != 0)) || iy > 0x7ff00000 || ((iy == 0x7ff00000) && (ly != 0))) return x + y;
  yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      k = (iy >> 20) - 0x3ff;
      if (k > 20) { j = ly >> (52 - k); if (((uint32_t)j << (52 - k)) == ly) yisint = 2 - (j & 1); }
      else if (ly == 0) { j = iy >> (20 - k); if ((j << (20 - k)) == iy) yisint = 2 - (j & 1); }
    }
  }
  if (ly == 0) {
    if (iy == 0x7ff00000) {
      if (((ix - 0x3ff00000) | lx) == 0) return y - y;
      else if (ix >= 0x3ff00000) return (hy >= 0) ? y : 0.0;
      else return (hy < 0) ? -y : 0.0;
    }
    if (iy == 0x3ff00000) { if (hy < 0) return 1.0 / x; else return x; }
    if (hy == 0x40000000) return x * x;
    if (hy == 0x3fe00000) { if (hx >= 0) return sqrt(x); }
  }
  ax = fabs(x);
  if (lx == 0) {
    if (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000) {
      z = ax;
      if (hy < 0) z = 1.0 / z;
      if (hx < 0) {
        if (((ix - 0x3ff00000) | yisint) == 0) z = (z - z) / (z - z);
        else if (yisint == 1) z = -z;
      }
      return z;
    }
  }
  n = ((uint32_t)hx >> 31) - 1;
  if ((n | yisint) == 0) return (x - x) / (x - x);
  s = 1.0;
  if ((n | (yisint - 1)) == 0) s = -1.0;
  if (iy > 0x41e00000) {
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return (hy < 0) ? pw_huge * pw_huge : pw_tiny * pw_tiny;
      if (ix >= 0x3ff00000) return (hy > 0) ? pw_huge * pw_huge : pw_tiny * pw_tiny;
    }
    if (ix < 0x3fefffff) return (hy < 0) ? s * pw_huge * pw_huge : s * pw_tiny * pw_tiny;
    if (ix > 0x3ff00000) return (hy > 0) ? s * pw_huge * pw_huge : s * pw_tiny * pw_tiny;
    t = ax - 1.0;
    w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    u = pw_ivln2_h * t; v = t * pw_ivln2_l - w * pw_ivln2;
    t1 = u + v; SET_LOW_WORD(t1, 0); t2 = v - (t1 - u);
  } else {
    double ss, s2, s_h, s_l, t_h, t_l;
    n = 0;
    if (ix < 0x00100000) { ax *= pw_two53; n -= 53; GET_HIGH_WORD(ix, ax); }
    n += ((ix) >> 20) - 0x3ff;
    j = ix & 0x000fffff; ix = j | 0x3ff00000;
    if (j <= 0x3988E) k = 0; else if (j < 0xBB67A) k = 1; else { k = 0; n += 1; ix -= 0x00100000; }
    SET_HIGH_WORD(ax, ix);
    u = ax - pw_bp[k]; v = 1.0 / (ax + pw_bp[k]); ss = u * v; s_h = ss; SET_LOW_WORD(s_h, 0);
    t_h = 0.0; SET_HIGH_WORD(t_h, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
    t_l = ax - (t_h - pw_bp[k]); s_l = v * ((u - s_h * t_h) - s_h * t_l);
    s2 = ss * ss; r = s2 * s2 * (pw_L1 + s2 * (pw_L2 + s2 * (pw_L3 + s2 * (pw_L4 + s2 * (pw_L5 + s2 * pw_L6)))));
    r += s_l * (s_h + ss); s2 = s_h * s_h; t_h = 3.0 + s2 + r; SET_LOW_WORD(t_h, 0); t_l = r - ((t_h - 3.0) - s2);
    u = s_h * t_h; v = s_l * t_h + t_l * ss; p_h = u + v; SET_LOW_WORD(p_h, 0); p_l = v - (p_h - u);
    z_h = pw_cp_h * p_h; z_l = pw_cp_l * p_h + p_l * pw_cp + pw_dp_l[k];
    t = (double)n; t1 = (((z_h + z_l) + pw_dp_h[k]) + t); SET_LOW_WORD(t1, 0); t2 = z_l - (((t1 - t) - pw_dp_h[k]) - z_h);
  }
  y1 = y; SET_LOW_WORD(y1, 0);
  p_l = (y - y1) * t1 + y * t2; p_h = y1 * t1; z = p_l + p_h;
  EXTRACT_WORDS(j, i, z);
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) != 0) return s * pw_huge * pw_huge;
    if (p_l + pw_ovt > z - p_h) return s * pw_huge * pw_huge;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - 0xc090cc00) | i) != 0) return s * pw_tiny * pw_tiny;
    if (p_l <= z - p_h) return s * pw_tiny * pw_tiny;
  }
  i = j & 0x7fffffff; k = (i >> 20) - 0x3ff; n = 0;
  if (i > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1)); k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    t = 0.0; SET_HIGH_WORD(t, n & ~(0x000fffff >> k));
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  t = p_l + p_h; SET_LOW_WORD(t, 0);
  u = t * pw_lg2_h; v = (p_l - (t - p_h)) * pw_lg2 + t * pw_lg2_l;
  z = u + v; w = v - (z - u); t = z * z;
  t1 = z - t * (pw_P1 + t * (pw_P2 + t * (pw_P3 + t * (pw_P4 + t * pw_P5))));
  r = (z * t1) / (t1 - 2.0) - (w + z * w);
  z = 1.0 - (r - z);
  GET_HIGH_WORD(j, z); j += (n << 20);
  if ((j >> 20) <= 0) z = scalbn(z, n); else SET_HIGH_WORD(z, j);
  return s * z;
}
/* V8's Math.hypot over n values (src/builtins/math.tq): any Infinity answers +Infinity (it beats a NaN), else any NaN answers NaN, else
 * zero when every magnitude is zero; otherwise the largest magnitude scales the rest and the squares of the scaled magnitudes are summed with
 * Kahan compensation. */
double scr_fd_hypot(const double *v, size_t n) {
  double mx = 0.0, sum = 0.0, comp = 0.0; int nan = 0;
  for (size_t i = 0; i < n; i++) {
    if (isnan(v[i])) nan = 1;
    else { double a = fabs(v[i]); if (a > mx) mx = a; }
  }
  if (mx == INFINITY) return INFINITY;
  if (nan) return NAN;
  if (mx == 0.0) return 0.0;
  for (size_t i = 0; i < n; i++) {
    double a = isnan(v[i]) ? 0.0 : fabs(v[i]);
    double q = a / mx, summand = q * q - comp, pre = sum + summand;
    comp = (pre - sum) - summand; sum = pre;
  }
  return sqrt(sum) * mx;
}
double scr_fd_hypot2(double a, double b) {
  double v[2];
  v[0] = a; v[1] = b;
  return scr_fd_hypot(v, 2);
}
double scr_math_hypot_arr(ScrArr *a) {
  if (a->len == 0) return 0.0;
  double stackv[16], *v = stackv; double r;
  if (a->len > 16) { v = (double *)malloc(a->len * sizeof *v); if (v == NULL) { fputs("scriptc: out of memory\n", stderr); abort(); } }
  for (size_t i = 0; i < a->len; i++) memcpy(&v[i], &a->data[i], sizeof v[i]); /* a slot holds the double's own bits */
  r = scr_fd_hypot(v, a->len);
  if (v != stackv) free(v);
  return r;
}
